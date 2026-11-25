import { describe, expect, test } from 'bun:test';
import { VisualClock } from '../../src/panes/visual-clock';

describe('VisualClock', () => {
  test('advances at its rate, pauses, seeks and ends once', () => {
    const states: boolean[] = [];
    let ended = 0;
    const clock = new VisualClock(10, (playing) => states.push(playing), () => { ended += 1; });

    clock.playbackRate = 2;
    clock.play();
    expect(clock.advance(1000)).toBe(0);
    expect(clock.advance(2500)).toBe(3);
    clock.pause();
    expect(clock.advance(5000)).toBe(3);
    clock.seek(9);
    clock.play();
    clock.advance(4000);
    expect(clock.advance(5000)).toBe(10);
    expect(ended).toBe(1);
    expect(states).toEqual([true, false, true, false]);
  });
});
