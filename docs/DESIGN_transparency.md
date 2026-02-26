# Event Transparency (Free/Busy) Design Note

## Overview

Add support for event "time transparency" (free/busy blocking) by storing source calendar transparency and exposing it in `GET /v1/events` responses.

## Mapping Table

| Source | Field/Property | Values | Internal Normalized | blocksTime |
|--------|---------------|--------|---------------------|------------|
| Google Calendar | `event.transparency` | `"opaque"` (default if missing) | `"opaque"` | `true` |
| Google Calendar | `event.transparency` | `"transparent"` | `"transparent"` | `false` |
| ICS/iCalendar | `TRANSP` | `OPAQUE` (default if missing) | `"opaque"` | `true` |
| ICS/iCalendar | `TRANSP` | `TRANSPARENT` | `"transparent"` | `false` |

**Default behavior**: If the transparency field is missing from the source, assume `"opaque"` (blocks time). This matches both Google Calendar and RFC 5545 (iCalendar) specifications.

## Database Changes

### New Column on `raw_events`

```sql
ALTER TABLE raw_events ADD COLUMN transparency TEXT DEFAULT 'opaque';
```

- **Column**: `transparency`
- **Type**: `TEXT`
- **Default**: `'opaque'`
- **Values**: `'opaque'` | `'transparent'`

**Rationale**: 
- Single normalized column is sufficient since we already store `source_json` which preserves the raw source value.
- Default of `'opaque'` ensures existing rows and new rows with missing values behave correctly.
- No separate `raw_transparency` column needed—`source_json` already contains the original Google `transparency` field or ICS `transp` property.

### Migration Strategy

1. **Add column with default**: Safe online migration, no table lock issues with SQLite.
2. **Backfill**: Run a one-time backfill script that:
   - Parses `source_json` for each row
   - Extracts `transparency` (Google) or `transp` (ICS)
   - Updates the `transparency` column accordingly
3. **Backfill is idempotent**: Can be re-run safely.

## API Response Shape

### `GET /v1/events` - New `timeTransparency` Field

```typescript
type EventOut = {
  // ... existing fields ...
  
  timeTransparency: {
    blocksTime: boolean;           // true = opaque (busy), false = transparent (free)
    value: 'opaque' | 'transparent';
    source: {
      provider: 'google' | 'ics';
      rawValue: string | null;     // Original value from source, null if missing
    };
  };
};
```

**Example responses**:

```json
// Google event with explicit transparency
{
  "uid": "abc123",
  "summary": "Team Meeting",
  "timeTransparency": {
    "blocksTime": true,
    "value": "opaque",
    "source": {
      "provider": "google",
      "rawValue": "opaque"
    }
  }
}

// ICS event with TRANSP:TRANSPARENT
{
  "uid": "def456",
  "summary": "Out of Office",
  "timeTransparency": {
    "blocksTime": false,
    "value": "transparent",
    "source": {
      "provider": "ics",
      "rawValue": "TRANSPARENT"
    }
  }
}

// Event with missing transparency (defaults to opaque)
{
  "uid": "ghi789",
  "summary": "Quick Sync",
  "timeTransparency": {
    "blocksTime": true,
    "value": "opaque",
    "source": {
      "provider": "google",
      "rawValue": null
    }
  }
}
```

**Why this shape?**
- `blocksTime`: Boolean for easy consumption by scheduling logic
- `value`: Normalized string for display/filtering
- `source.provider`: Indicates origin calendar type
- `source.rawValue`: Preserves original value for debugging/auditing; `null` when source didn't specify

## Edge Cases

### Recurring Events

- **Master event**: Transparency stored on master row; inherited by all generated instances.
- **Instance overrides**: If a recurring event exception has its own transparency, it's stored on the override row and used for that instance.
- **Implementation**: Already handled by existing override logic in `expand.ts`—we just need to include transparency in the output.

### Cancelled Events

- Cancelled events retain their transparency value but are typically filtered out by `includeCancelled=false`.
- No special handling needed.

### All-Day Events

- Transparency applies equally to all-day events.
- Google Calendar and ICS both support transparency on all-day events.
- No special handling needed.

### Missing Values

- **Google**: If `event.transparency` is undefined/null, default to `"opaque"`.
- **ICS**: If `TRANSP` property is absent, default to `"opaque"` per RFC 5545.

## Impact on Existing Features

### `/v1/freebusy` Endpoint

**Current behavior**: Returns all events as busy intervals.

**Consideration**: Should transparent events be excluded from free/busy calculations?

**Decision**: **No change in this PR**. The `/v1/freebusy` endpoint currently treats all events as blocking. Changing this would alter scheduling behavior. If desired, this should be a separate follow-up PR with explicit opt-in (e.g., `?respectTransparency=true` query param).

**Documented as follow-up**: See "Future Work" section.

## Implementation Checklist

1. [ ] DB migration: Add `transparency` column to `raw_events`
2. [ ] Update `RawEventRow` type in `repo.ts`
3. [ ] Update `RawRow` type in `expand.ts`
4. [ ] Google ingestion: Extract `transparency` from Google event, default to `'opaque'`
5. [ ] ICS ingestion: Extract `transp` from ICS event, normalize and default to `'opaque'`
6. [ ] Update `EventOut` type with `timeTransparency` field
7. [ ] Update `expandWindow` to include transparency in output
8. [ ] Write unit tests for Google transparency mapping
9. [ ] Write unit tests for ICS TRANSP parsing
10. [ ] Write integration tests for `GET /v1/events` transparency output
11. [ ] Create backfill script for existing events
12. [ ] Update API documentation

## Future Work

- **`/v1/freebusy` transparency support**: Add query param to optionally exclude transparent events from busy intervals.
- **Outlook/Exchange support**: Map `showAs` field when Outlook ingestion is added.

## Assumptions

1. **No existing `transparency` column**: Verified schema has no such column.
2. **`source_json` contains raw values**: Confirmed Google events store full event object; ICS stores relevant fields.
3. **SQLite default handling**: `DEFAULT 'opaque'` applies to new inserts; existing rows get `NULL` until backfill runs, so we handle `NULL` as `'opaque'` in code.
