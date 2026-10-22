"use client";

import type { FormEvent } from "react";
import type { Filters } from "../lib/filters";

export function FilterForm({ pathname, filters }: { pathname: string; filters: Filters }) {
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    for (const element of event.currentTarget.elements) {
      if (element instanceof HTMLInputElement && element.value.length === 0) element.disabled = true;
    }
  }

  return (
    <form className="filters" method="get" action={pathname} autoComplete="off" onSubmit={onSubmit}>
      <label>
        repo
        <input name="repo" defaultValue={filters.repo ?? ""} spellCheck={false} />
      </label>
      <label>
        branch
        <input name="branch" defaultValue={filters.branch ?? ""} spellCheck={false} />
      </label>
      <label>
        from
        <input name="from" defaultValue={filters.from ?? ""} inputMode="numeric" />
      </label>
      <label>
        to
        <input name="to" defaultValue={filters.to ?? ""} inputMode="numeric" />
      </label>
      <label>
        key
        <input name="key" defaultValue={filters.key ?? ""} autoComplete="off" spellCheck={false} />
      </label>
      <label>
        cursor
        <input name="cursor" defaultValue={filters.cursor ?? ""} inputMode="numeric" />
      </label>
      <label>
        limit
        <input name="limit" type="number" min={1} max={1000} defaultValue={filters.limit} />
      </label>
      <div className="filter-actions">
        <button type="submit">Застосувати</button>
        <a href={pathname}>Скинути</a>
      </div>
      <p className="hint">
        repo порівнюється з нормалізованим repo_key. key — це id credential у scope читання, не секрет API.
        from і to — Unix-час у секундах. limit від 1 до 1000, типово 100. cursor — id останнього рядка попередньої сторінки.
      </p>
    </form>
  );
}
