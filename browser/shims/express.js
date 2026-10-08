// Express gibt es im Browser nicht — die Seite liefert sich selbst aus.
function express() {
  return { use() {}, get() {}, post() {} };
}
express.static = () => () => {};
module.exports = express;
