import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import { APP_CONFIG } from '../../config/app-config.module';
import type { Env } from '../../config/env.schema';
import type { AuthenticatedUser } from '../context/request-context';
import { UnauthorizedError } from '../kernel/domain-error';

interface SupabaseClaims extends JWTPayload {
  sub?: string;
  email?: string;
  role?: string;
  aal?: string;
  is_anonymous?: boolean;
}

/**
 * Verifies Supabase access tokens locally.
 *
 * Local verification is deliberate: calling `auth.getUser()` on every request
 * would add a network round trip to the auth server to each API call and make
 * the API's availability depend on it. The signature, issuer, audience and
 * expiry are all checkable offline.
 *
 * Both signing schemes are supported. Legacy projects sign symmetrically with
 * the project JWT secret (HS256); current projects sign asymmetrically and
 * publish a rotating JWKS. The algorithm is read from the token header and the
 * matching key material is used — a token is never verified with an algorithm
 * the deployment did not configure.
 */
@Injectable()
export class SupabaseTokenVerifier {
  private readonly logger = new Logger(SupabaseTokenVerifier.name);
  private readonly issuer: string;
  private readonly hmacKey?: Uint8Array;
  private readonly jwks?: JWTVerifyGetKey;

  constructor(@Inject(APP_CONFIG) config: Env) {
    this.issuer = `${config.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;

    if (config.SUPABASE_JWT_SECRET) {
      this.hmacKey = new TextEncoder().encode(config.SUPABASE_JWT_SECRET);
    }

    // `createRemoteJWKSet` caches the key set and refetches on unknown `kid`,
    // so key rotation is handled without a restart.
    this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`), {
      cacheMaxAge: 10 * 60 * 1000,
      cooldownDuration: 30 * 1000,
    });
  }

  async verify(token: string): Promise<AuthenticatedUser> {
    let claims: SupabaseClaims;

    try {
      const { alg } = decodeProtectedHeader(token);

      if (alg === 'HS256') {
        if (!this.hmacKey) {
          throw new UnauthorizedError('symmetric tokens are not accepted by this deployment');
        }
        ({ payload: claims } = await jwtVerify<SupabaseClaims>(token, this.hmacKey, {
          issuer: this.issuer,
          audience: 'authenticated',
          algorithms: ['HS256'],
        }));
      } else {
        if (!this.jwks) throw new UnauthorizedError('no key set configured');
        ({ payload: claims } = await jwtVerify<SupabaseClaims>(token, this.jwks, {
          issuer: this.issuer,
          audience: 'authenticated',
          algorithms: ['RS256', 'ES256', 'EdDSA'],
        }));
      }
    } catch (error) {
      if (error instanceof UnauthorizedError) throw error;
      this.logger.debug({ err: error }, 'token verification failed');
      throw new UnauthorizedError('invalid or expired session');
    }

    if (!claims.sub) throw new UnauthorizedError('token is missing a subject');
    if (claims.role !== 'authenticated') {
      throw new UnauthorizedError('token does not carry the authenticated role');
    }
    // Anonymous sign-in is disabled in config.toml; reject defensively in case
    // it is ever re-enabled without revisiting authorisation.
    if (claims.is_anonymous === true) {
      throw new UnauthorizedError('anonymous sessions are not permitted');
    }

    return {
      id: claims.sub,
      email: typeof claims.email === 'string' ? claims.email : null,
      accessToken: token,
      assuranceLevel: claims.aal === 'aal2' ? 'aal2' : 'aal1',
    };
  }
}
