# Events API

## GET /v1/events

Returns expanded calendar events within a time window.

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `start` | string (ISO 8601) | Yes | Start of time window |
| `end` | string (ISO 8601) | Yes | End of time window |
| `includeCancelled` | boolean | No | Include cancelled events (default: false) |
| `clientZone` | string | No | IANA timezone for output (default: UTC) |

### Response

Returns an array of event objects.

### Event Object

```typescript
{
  uid: string;
  calendarId: string;
  summary: string | null;
  description: string | null;
  location: string | null;
  start: string;              // ISO 8601 datetime
  end: string;                // ISO 8601 datetime
  allDay: boolean;
  status: string | null;
  recurrence: {
    isRecurring: boolean;
    masterUid?: string;       // Present if isRecurring is true
    recurrenceId?: string;    // Present if this is a recurring instance
  };
  source: {
    type: 'google' | 'ics';
    id: string;
  };
  timeTransparency: {         // NEW in v0.2.0
    blocksTime: boolean;      // true = event blocks time (busy), false = free
    value: 'opaque' | 'transparent';
    source: {
      provider: 'google' | 'ics';
      rawValue: string | null;  // Original value from source, null if missing
    };
  };
}
```

### timeTransparency Field

The `timeTransparency` field indicates whether an event blocks time on the calendar (shows as "busy") or is transparent (shows as "free").

#### Values

| value | blocksTime | Description |
|-------|------------|-------------|
| `opaque` | `true` | Event blocks time; user is busy |
| `transparent` | `false` | Event does not block time; user is free |

#### Source Mapping

| Calendar Source | Source Field | Raw Values | Normalized Value |
|-----------------|--------------|------------|------------------|
| Google Calendar | `event.transparency` | `"opaque"`, `"transparent"` | `"opaque"`, `"transparent"` |
| ICS/iCalendar | `TRANSP` property | `OPAQUE`, `TRANSPARENT` | `"opaque"`, `"transparent"` |

#### Default Behavior

If the source event does not specify transparency:
- **Google Calendar**: Defaults to `"opaque"` (blocks time)
- **ICS/iCalendar**: Defaults to `"opaque"` per RFC 5545

The `source.rawValue` will be `null` when the source did not explicitly specify a value.

### Example Response

```json
[
  {
    "uid": "abc123@google.com",
    "calendarId": "gcal_a1b2c3d4e5f6",
    "summary": "Team Meeting",
    "description": "Weekly sync",
    "location": "Conference Room A",
    "start": "2024-01-15T10:00:00.000Z",
    "end": "2024-01-15T11:00:00.000Z",
    "allDay": false,
    "status": "confirmed",
    "recurrence": {
      "isRecurring": true,
      "masterUid": "abc123@google.com",
      "recurrenceId": "2024-01-15T10:00:00.000Z"
    },
    "source": {
      "type": "google",
      "id": "abc123@google.com"
    },
    "timeTransparency": {
      "blocksTime": true,
      "value": "opaque",
      "source": {
        "provider": "google",
        "rawValue": "opaque"
      }
    }
  },
  {
    "uid": "def456@example.com",
    "calendarId": "ics_f6e5d4c3b2a1",
    "summary": "Out of Office",
    "description": null,
    "location": null,
    "start": "2024-01-15T00:00:00.000Z",
    "end": "2024-01-16T00:00:00.000Z",
    "allDay": true,
    "status": null,
    "recurrence": {
      "isRecurring": false
    },
    "source": {
      "type": "ics",
      "id": "def456@example.com"
    },
    "timeTransparency": {
      "blocksTime": false,
      "value": "transparent",
      "source": {
        "provider": "ics",
        "rawValue": "TRANSPARENT"
      }
    }
  }
]
```

## GET /v1/freebusy

Returns coalesced busy intervals for calendars.

> **Note**: Currently, this endpoint treats all events as blocking time regardless of their `timeTransparency` value. A future update may add support for respecting transparency via a query parameter.

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `start` | string (ISO 8601) | Yes | Start of time window |
| `end` | string (ISO 8601) | Yes | End of time window |

### Response

```typescript
{
  calendars: {
    [calendarId: string]: Array<{ start: string; end: string }>;
  };
  merged: Array<{ start: string; end: string }>;
}
```
