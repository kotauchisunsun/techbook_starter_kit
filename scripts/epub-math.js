// Temml groups inline expressions into top-level mrows for CSS flex wrapping.
// Apply that strategy conservatively to long, simple display expressions only.
// Fractions, radicals, nested groups and aligned tables remain atomic.
const operators = new Set(['+', '−', '-', '±', '∓', '×', '⋅', '·', '÷', '/', '=', '≠', '≈', '≃', '≡', '<', '>', '≤', '≥', '∪', '∩', '∧', '∨', '⊕', '⊗']);
const opening = new Map([['(', ')'], ['[', ']'], ['{', '}'], ['⟨', '⟩'], ['⌈', '⌉'], ['⌊', '⌋']]);
const closing = new Set(opening.values());
const symmetric = new Set(['|', '‖', '∣', '∥']);
const text = node => node.type === 'text' ? node.value : (node.children ?? []).map(text).join('');
const trivia = node => node.type === 'comment' || (node.type === 'text' && !node.value.trim());
const contains = (node, predicate) => predicate(node) || (node.children ?? []).some(child => contains(child, predicate));
const property = (node, name) => Object.entries(node.properties ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];

function operand(node) {
  if (!node || node.type !== 'element' || node.tagName === 'mspace') return false;
  if (node.tagName !== 'mo') return true;
  return property(node, 'form') === 'postfix' || closing.has(text(node).trim()) || symmetric.has(text(node).trim());
}

function wrapDisplayMath(math, minimumLength) {
  if (math.properties?.display !== 'block') return;
  if (text(math).replace(/\s/gu, '').length < minimumLength) return;
  const roots = math.children.filter(node => !trivia(node));
  if (roots.length !== 1 || roots[0].type !== 'element' || roots[0].tagName !== 'mrow') return;
  const row = roots[0];
  // Moving a styled/id-bearing row into several sibling rows changes scope.
  if (Object.keys(row.properties ?? {}).length) return;
  if (contains(row, node => node.tagName === 'mtable' || property(node, 'linebreak') === 'newline')) return;
  if (row.children.some(node => node.type !== 'element' && !trivia(node))) return;

  const fences = [];
  const breaks = [];
  let previous;
  let invalid = false;
  for (let i = 0; i < row.children.length; i++) {
    const node = row.children[i];
    if (trivia(node) || node.tagName === 'mspace') continue;
    if (node.tagName !== 'mo') { previous = node; continue; }
    const value = text(node).trim();
    const form = property(node, 'form');
    const isFence = ['true', true].includes(property(node, 'fence'));
    if (opening.has(value) || (isFence && form === 'prefix')) {
      fences.push(opening.get(value) ?? null);
    } else if (closing.has(value) || (isFence && form === 'postfix')) {
      const expected = fences.pop();
      if (expected === undefined || (expected !== null && expected !== value)) { invalid = true; break; }
    } else if (symmetric.has(value)) {
      if (fences.at(-1) === value) fences.pop();
      else fences.push(value);
    } else if (!fences.length && operators.has(value) && form !== 'prefix' && form !== 'postfix'
      && property(node, 'movablelimits') === undefined && property(node, 'linebreak') !== 'nobreak' && operand(previous)) {
      // Keep post-operator spaces on the same line and honor explicit no-break
      // glue. Pretty-print whitespace is preserved, not interpreted as math.
      let end = i + 1;
      let noBreak = false;
      while (end < row.children.length && (trivia(row.children[end]) || row.children[end].tagName === 'mspace')) {
        if (property(row.children[end], 'linebreak') === 'nobreak') noBreak = true;
        end++;
      }
      const next = row.children[end];
      if (next && property(next, 'linebreak') !== 'nobreak' && !noBreak) breaks.push({ end, operator: node });
    }
    previous = node;
  }
  // Do not partially transform an expression with ambiguous/unbalanced fences.
  if (invalid || fences.length || !breaks.length) return;

  const fragments = [];
  let start = 0;
  for (const boundary of breaks) {
    // Keep the original infix spacing when an operator becomes the last child
    // of a new mrow. All other operator attributes and descendants are retained.
    boundary.operator.properties = { ...boundary.operator.properties, form: 'infix' };
    fragments.push({ type: 'element', tagName: 'mrow', properties: {}, children: row.children.slice(start, boundary.end) });
    start = boundary.end;
  }
  fragments.push({ type: 'element', tagName: 'mrow', properties: {}, children: row.children.slice(start) });
  const position = math.children.indexOf(row);
  math.children.splice(position, 1, ...fragments);
  const classes = math.properties.className ?? [];
  math.properties.className = [...new Set([...(Array.isArray(classes) ? classes : classes.split(/\s+/u)), 'epub-math-wrap'])];
}

// Append to the existing VFM processor: baseProcessor(options, metadata)
//   .use(epubMath, { minimumLength: 32 }). No parser or serializer is replaced.
export default function epubMath({ minimumLength = 32 } = {}) {
  if (!Number.isInteger(minimumLength) || minimumLength < 1) throw new Error('minimumLength must be a positive integer.');
  return tree => {
    const walk = node => {
      if (node.type === 'element' && node.tagName === 'math') { wrapDisplayMath(node, minimumLength); return; }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}
