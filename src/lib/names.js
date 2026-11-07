// Shared by the site and the worker (plain JS so both can import it).

// Coupang seller titles are long and keyword-stuffed, e.g.
//   "[백화점 입점] 풀라스 UV 살균 대용량 무선 미니 가습기 … humidifier, 화이트, FL-HF1000"
// For page titles keep the head of the name (cut at a word boundary) plus
// short option parts (용량·수량·색상) so options of one product stay distinct.
export function shortProductName(name, max = 28) {
  const [head = '', ...opts] = String(name)
    .replace(/\[[^\]]*\]/g, ' ')
    .split(',')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  let short = head;
  if (short.length > max) {
    const cut = short.slice(0, max);
    const space = cut.lastIndexOf(' ');
    short = (space > max / 2 ? cut.slice(0, space) : cut).trim();
  }
  const opt = opts.filter((o) => !short.includes(o)).join(' ');
  return opt && short.length + opt.length < 44 ? `${short} ${opt}` : short;
}
