const PREFIX = '[queue]';

function fmt(tag, args) {
  return tag ? [`${PREFIX}[${tag}]`, ...args] : [PREFIX, ...args];
}

module.exports = {
  info(tag, ...args)  { console.log(...fmt(tag, args)); },
  warn(tag, ...args)  { console.warn(...fmt(tag, args)); },
  error(tag, ...args) { console.error(...fmt(tag, args)); },
};
