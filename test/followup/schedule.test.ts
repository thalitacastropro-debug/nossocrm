import { describe, it, expect } from 'vitest';
import {
  classifyCadence, scheduleFor, computeAnchor, initState, nextDueTouch,
  advanceState, isReengaged, COLD_SCHEDULE_MS, WARM_SCHEDULE_MS,
  type FollowupState,
} from '@/lib/ai/followup/schedule';

const anchor = '2026-07-13T13:00:00.000Z';
const anchorMs = Date.parse(anchor);
const cold = (count: number, over: Partial<FollowupState> = {}): FollowupState => ({
  cadence: 'cold', anchor_at: anchor, count, stopped: false, ...over,
});

describe('classifyCadence', () => {
  it('sem first_response_at => cold', () => expect(classifyCadence(null)).toBe('cold'));
  it('com first_response_at => warm', () => expect(classifyCadence('2026-07-13T12:00:00Z')).toBe('warm'));
});

describe('computeAnchor', () => {
  it('cold usa first_touch.sent_at quando existe', () => {
    expect(computeAnchor({ cadence: 'cold', firstTouchSentAt: anchor, lastMessageAt: '2026-07-13T18:00:00Z' })).toBe(anchor);
  });
  it('cold sem first_touch cai no last_message_at', () => {
    expect(computeAnchor({ cadence: 'cold', firstTouchSentAt: null, lastMessageAt: anchor })).toBe(anchor);
  });
  it('warm sempre usa last_message_at', () => {
    expect(computeAnchor({ cadence: 'warm', firstTouchSentAt: '2026-01-01T00:00:00Z', lastMessageAt: anchor })).toBe(anchor);
  });
});

describe('initState', () => {
  it('estado zerado', () => {
    expect(initState('warm', anchor)).toEqual({
      cadence: 'warm', anchor_at: anchor, count: 0, last_sent_at: null, stopped: false, stopped_reason: null,
    });
  });
});

describe('nextDueTouch', () => {
  it('não devido antes da janela', () => {
    const now = new Date(anchorMs + COLD_SCHEDULE_MS[0] - 1000);
    expect(nextDueTouch(cold(0), now)).toBeNull();
  });
  it('devido no toque 0 quando a janela passou', () => {
    const now = new Date(anchorMs + COLD_SCHEDULE_MS[0] + 1000);
    expect(nextDueTouch(cold(0), now)).toEqual({ touchIndex: 0, isLast: false });
  });
  it('último toque marca isLast', () => {
    const now = new Date(anchorMs + COLD_SCHEDULE_MS[3] + 1000);
    expect(nextDueTouch(cold(3), now)).toEqual({ touchIndex: 3, isLast: true });
  });
  it('count >= schedule.length => null', () => {
    const now = new Date(anchorMs + 999 * 3600_000);
    expect(nextDueTouch(cold(4), now)).toBeNull();
  });
  it('stopped => null', () => {
    const now = new Date(anchorMs + 999 * 3600_000);
    expect(nextDueTouch(cold(1, { stopped: true }), now)).toBeNull();
  });
  it('warm toque 0 devido em +15min', () => {
    const now = new Date(anchorMs + WARM_SCHEDULE_MS[0] + 1000);
    expect(nextDueTouch({ cadence: 'warm', anchor_at: anchor, count: 0, stopped: false }, now)).toEqual({ touchIndex: 0, isLast: false });
  });
});

describe('advanceState', () => {
  it('incrementa count e não para no meio', () => {
    const s = advanceState(cold(0), new Date(anchorMs));
    expect(s.count).toBe(1);
    expect(s.stopped).toBe(false);
    expect(s.last_sent_at).toBe(new Date(anchorMs).toISOString());
  });
  it('para (stopped=max_touches) no último toque', () => {
    const s = advanceState({ cadence: 'warm', anchor_at: anchor, count: 2, stopped: false }, new Date(anchorMs));
    expect(s.count).toBe(3);
    expect(s.stopped).toBe(true);
    expect(s.stopped_reason).toBe('max_touches');
  });
});

describe('isReengaged', () => {
  it('inbound depois da âncora => true', () => expect(isReengaged(anchor, '2026-07-13T13:00:01Z')).toBe(true));
  it('inbound antes da âncora => false', () => expect(isReengaged(anchor, '2026-07-13T12:59:59Z')).toBe(false));
  it('sem inbound => false', () => expect(isReengaged(anchor, null)).toBe(false));
});

describe('scheduleFor', () => {
  it('cold tem 4 toques, warm tem 3', () => {
    expect(scheduleFor('cold')).toHaveLength(4);
    expect(scheduleFor('warm')).toHaveLength(3);
  });
});
