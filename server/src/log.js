// Concise leveled logger. LOG_LEVEL = debug | info | warn | error | silent (default info).
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
let threshold = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

export function setLogLevel(level) {
  if (level in LEVELS) threshold = LEVELS[level];
}

function stamp() {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

function write(level, scope, args) {
  if (LEVELS[level] < threshold) return;
  const line = `${stamp()} ${level.toUpperCase().padEnd(5)} [${scope}]`;
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  out(line, ...args.map((a) => (a instanceof Error ? a.stack || a.message : a)));
}

export function logger(scope) {
  return {
    debug: (...a) => write('debug', scope, a),
    info: (...a) => write('info', scope, a),
    warn: (...a) => write('warn', scope, a),
    error: (...a) => write('error', scope, a),
  };
}
