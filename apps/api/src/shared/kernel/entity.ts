import { randomUUID } from 'node:crypto';
import type { DomainEvent } from './domain-event';

/**
 * Identity-based equality: two entities are the same entity when their ids
 * match, regardless of attribute drift. Value objects use structural equality
 * instead and simply live as frozen interfaces in `domain/value-objects`.
 */
export abstract class Entity<TId extends string = string> {
  protected constructor(public readonly id: TId) {}

  equals(other?: Entity<TId> | null): boolean {
    if (other === null || other === undefined) return false;
    if (this === other) return true;
    return this.id === other.id;
  }
}

/**
 * An aggregate root is the only object an outside caller may hold a reference
 * to; everything inside the aggregate is reached through it. It records the
 * domain events its behaviour produced so the application layer can publish
 * them after the transaction succeeds.
 */
export abstract class AggregateRoot<TId extends string = string> extends Entity<TId> {
  #events: DomainEvent[] = [];

  protected record(event: DomainEvent): void {
    this.#events.push(event);
  }

  pullEvents(): DomainEvent[] {
    const events = this.#events;
    this.#events = [];
    return events;
  }

  get hasUncommittedEvents(): boolean {
    return this.#events.length > 0;
  }
}

export const newId = (): string => randomUUID();
