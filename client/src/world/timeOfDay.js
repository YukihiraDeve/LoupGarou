// Sun course driven by the game phase (contract table "Temps et soleil").
// Output: elevation in degrees and the sun's course s (0 = east horizon, 1 = west horizon).
import { PHASES, NIGHT_STEPS } from '@shared/protocol.js';
import { clamp, lerp, easeInOut, easeOut } from '../util/math.js';

export class SunClock {
  constructor() {
    this.key = '';
    this.startElev = 4;
    this.startCourse = 0.88;
    this.lastElev = 4;
    this.lastCourse = 0.88;
    this.prevPhase = null;
    this.phase = null;
    this.result = { elevation: 4, course: 0.88 };
  }

  /** @param st StateSnapshot (or null for the lobby) @param now corrected server time (ms) */
  compute(st, now) {
    const phase = st?.phase || PHASES.LOBBY;
    const key = st ? `${phase}|${st.step}|${st.day}|${st.phaseStartedAt}` : 'lobby';
    if (key !== this.key) {
      this.key = key;
      this.startElev = this.lastElev;
      this.startCourse = this.lastCourse;
      if (phase !== this.phase) {
        this.prevPhase = this.phase;
        this.phase = phase;
      }
    }
    let p = 0;
    if (st && st.phaseEndsAt && st.phaseEndsAt > st.phaseStartedAt) {
      p = clamp((now - st.phaseStartedAt) / (st.phaseEndsAt - st.phaseStartedAt), 0, 1);
    }
    let e;
    let s;
    switch (phase) {
      case PHASES.ROLE_REVEAL: // golden hour
        e = lerp(12, 2, p);
        s = lerp(0.8, 0.9, p);
        break;
      case PHASES.NIGHT:
        if (st.step === NIGHT_STEPS.FALL) {
          // dusk: from wherever the sun was down to astronomical night
          e = lerp(this.startElev, -16, easeInOut(p));
          s = lerp(this.startCourse, 0.98, p);
        } else {
          e = lerp(Math.min(this.startElev, -16), -22, clamp(p * 2, 0, 1));
          s = 1;
        }
        break;
      case PHASES.DAWN: // pink dawn
        e = lerp(-6, 10, p);
        s = lerp(0, 0.12, p);
        break;
      case PHASES.ELECTION:
        e = lerp(10, 35, easeOut(p));
        s = lerp(0.12, 0.42, p);
        break;
      case PHASES.DEBATE: {
        const afterElection =
          this.prevPhase === PHASES.ELECTION ||
          (this.prevPhase == null && st.day === 1 && st.room?.config?.captain !== false);
        if (afterElection) {
          e = lerp(35, 14, easeInOut(p));
          s = lerp(0.42, 0.72, p);
        } else {
          e = p < 0.4 ? lerp(10, 35, easeOut(p / 0.4)) : lerp(35, 14, easeInOut((p - 0.4) / 0.6));
          s = lerp(0.12, 0.72, p);
        }
        break;
      }
      case PHASES.VOTE: // the vote closes when the sun touches the horizon
        e = lerp(14, 0, p);
        s = lerp(0.72, 0.9, p);
        break;
      case PHASES.EXECUTION: // red sunset
        e = lerp(0, -6, p);
        s = lerp(0.9, 0.95, p);
        break;
      case PHASES.HUNTER:
      case PHASES.CAPTAIN_SUCCESSION:
        e = this.startElev;
        s = this.startCourse;
        break;
      case PHASES.GAME_OVER: {
        const t = st ? clamp((now - st.phaseStartedAt) / 9000, 0, 1) : 1;
        e = lerp(this.startElev, 7, easeInOut(t));
        s = lerp(this.startCourse, 0.86, t);
        break;
      }
      default: // lobby: slow sunset drift behind the camp
        e = 7 + Math.sin(now * 0.00003) * 1.5;
        s = 0.86;
    }
    this.lastElev = e;
    this.lastCourse = s;
    this.result.elevation = e;
    this.result.course = s;
    return this.result;
  }
}
