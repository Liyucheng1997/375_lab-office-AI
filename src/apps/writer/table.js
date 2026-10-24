// 表格网格运算：考虑合并单元格(rowspan/colspan)的行列插入、删除、合并、拆分。

/** 构建网格：grid[r][c] = cell；pos: Map(cell -> {r, c, rs, cs}) */
export function buildGrid(table) {
  const grid = [];
  const pos = new Map();
  const rows = [...table.rows];
  rows.forEach((tr, r) => {
    grid[r] = grid[r] || [];
    let c = 0;
    for (const cell of tr.cells) {
      while (grid[r][c]) c++;
      const rs = Math.max(1, cell.rowSpan || 1);
      const cs = Math.max(1, cell.colSpan || 1);
      for (let i = 0; i < rs; i++) {
        grid[r + i] = grid[r + i] || [];
        for (let j = 0; j < cs; j++) grid[r + i][c + j] = cell;
      }
      pos.set(cell, { r, c, rs, cs });
      c += cs;
    }
  });
  const cols = Math.max(0, ...grid.map((row) => row.length));
  return { grid, pos, rows, cols };
}

function newCell(like) {
  const td = document.createElement(like && like.tagName === 'TH' ? 'th' : 'td');
  td.innerHTML = '<br>';
  if (like && like.style.backgroundColor) td.style.backgroundColor = like.style.backgroundColor;
  return td;
}

/** 在 row r 的 DOM 中，找到起始列 >= c 的第一个单元格（起始行为 r） */
function cellAtOrAfter(g, r, c) {
  const tr = g.rows[r];
  for (const cell of tr.cells) {
    if (g.pos.get(cell).c >= c) return cell;
  }
  return null;
}

/** 在第 t 行之前插入新行（t 可等于行数，表示末尾） */
export function insertRowAt(table, t) {
  const g = buildGrid(table);
  const tr = document.createElement('tr');
  const done = new Set();
  for (let c = 0; c < g.cols; c++) {
    const above = t > 0 ? g.grid[t - 1]?.[c] : null;
    const below = g.grid[t]?.[c];
    if (above && above === below) {
      if (!done.has(above)) { above.rowSpan = (above.rowSpan || 1) + 1; done.add(above); }
      c += g.pos.get(above).cs - 1;
    } else {
      tr.append(newCell(below || above));
    }
  }
  const ref = g.rows[t];
  if (ref) ref.before(tr);
  else (g.rows[g.rows.length - 1] || table).after(tr);
  return tr;
}

/** 在第 p 列之前插入新列 */
export function insertColAt(table, p) {
  const g = buildGrid(table);
  const done = new Set();
  g.rows.forEach((tr, r) => {
    const left = p > 0 ? g.grid[r][p - 1] : null;
    const right = g.grid[r][p];
    if (left && left === right) {
      if (!done.has(left)) { left.colSpan = (left.colSpan || 1) + 1; done.add(left); }
      return;
    }
    const cell = newCell(right || left);
    const after = cellAtOrAfter(g, r, p);
    if (after) after.before(cell);
    else tr.append(cell);
  });
}

export function deleteRow(table, r) {
  const g = buildGrid(table);
  const tr = g.rows[r];
  if (!tr) return;
  const seen = new Set();
  for (let c = 0; c < g.cols; c++) {
    const cell = g.grid[r][c];
    if (!cell || seen.has(cell)) continue;
    seen.add(cell);
    const p = g.pos.get(cell);
    if (p.rs > 1) {
      if (p.r === r) {
        // 把单元格移到下一行
        cell.rowSpan = p.rs - 1;
        const nextTr = g.rows[r + 1];
        const after = [...nextTr.cells].find((x) => g.pos.get(x).c > p.c);
        if (after) after.before(cell); else nextTr.append(cell);
      } else cell.rowSpan = p.rs - 1;
    }
  }
  tr.remove();
  if (!table.rows.length) table.remove();
}

export function deleteCol(table, c) {
  const g = buildGrid(table);
  const seen = new Set();
  for (let r = 0; r < g.rows.length; r++) {
    const cell = g.grid[r][c];
    if (!cell || seen.has(cell)) continue;
    seen.add(cell);
    if ((cell.colSpan || 1) > 1) cell.colSpan -= 1;
    else cell.remove();
  }
  [...table.rows].forEach((tr) => { if (!tr.cells.length) tr.remove(); });
  if (!table.rows.length || !table.querySelector('td,th')) table.remove();
}

/** 计算若干单元格的外接矩形 */
export function cellsRect(table, cells) {
  const g = buildGrid(table);
  let r1 = Infinity, c1 = Infinity, r2 = -1, c2 = -1;
  for (const cell of cells) {
    const p = g.pos.get(cell);
    if (!p) continue;
    r1 = Math.min(r1, p.r); c1 = Math.min(c1, p.c);
    r2 = Math.max(r2, p.r + p.rs - 1); c2 = Math.max(c2, p.c + p.cs - 1);
  }
  return { g, r1, c1, r2, c2 };
}

/** 选取矩形区域中的全部单元格 */
export function cellsInRect(table, a, b) {
  const g = buildGrid(table);
  const pa = g.pos.get(a), pb = g.pos.get(b);
  let r1 = Math.min(pa.r, pb.r), r2 = Math.max(pa.r + pa.rs - 1, pb.r + pb.rs - 1);
  let c1 = Math.min(pa.c, pb.c), c2 = Math.max(pa.c + pa.cs - 1, pb.c + pb.cs - 1);
  // 扩展以完整包含合并单元格
  let changed = true;
  while (changed) {
    changed = false;
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
      const cell = g.grid[r]?.[c];
      if (!cell) continue;
      const p = g.pos.get(cell);
      if (p.r < r1) { r1 = p.r; changed = true; }
      if (p.c < c1) { c1 = p.c; changed = true; }
      if (p.r + p.rs - 1 > r2) { r2 = p.r + p.rs - 1; changed = true; }
      if (p.c + p.cs - 1 > c2) { c2 = p.c + p.cs - 1; changed = true; }
    }
  }
  const set = new Set();
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (g.grid[r]?.[c]) set.add(g.grid[r][c]);
  return [...set];
}

export function mergeCells(table, cells) {
  if (cells.length < 2) return null;
  const { g, r1, c1, r2, c2 } = cellsRect(table, cells);
  const first = g.grid[r1][c1];
  const all = new Set();
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (g.grid[r]?.[c]) all.add(g.grid[r][c]);
  for (const cell of all) {
    if (cell === first) continue;
    const txt = cell.textContent.trim();
    if (txt || cell.querySelector('img')) {
      if (first.innerHTML === '<br>') first.innerHTML = '';
      else first.append(document.createElement('br'));
      while (cell.firstChild) first.append(cell.firstChild);
    }
    cell.remove();
  }
  first.rowSpan = r2 - r1 + 1;
  first.colSpan = c2 - c1 + 1;
  return first;
}

/** 拆分（取消合并）单元格 */
export function splitCell(table, cell) {
  const g = buildGrid(table);
  const p = g.pos.get(cell);
  if (!p || (p.rs === 1 && p.cs === 1)) return false;
  cell.rowSpan = 1;
  cell.colSpan = 1;
  for (let r = p.r; r < p.r + p.rs; r++) {
    const tr = g.rows[r];
    for (let c = p.c; c < p.c + p.cs; c++) {
      if (r === p.r && c === p.c) continue;
      const nc = newCell(cell);
      if (r === p.r) {
        // 同一行：插在原单元格之后（保持顺序）
        let ref = cell;
        for (let k = p.c + 1; k < c; k++) ref = ref.nextElementSibling || ref;
        ref.after(nc);
      } else {
        const after = [...tr.cells].find((x) => g.pos.get(x) && g.pos.get(x).c > c);
        if (after) after.before(nc); else tr.append(nc);
      }
    }
  }
  return true;
}

export function tableHTML(rows, cols, cls = '') {
  let s = `<table${cls ? ` class="${cls}"` : ''}><tbody>`;
  for (let r = 0; r < rows; r++) {
    s += '<tr>';
    for (let c = 0; c < cols; c++) s += '<td><br></td>';
    s += '</tr>';
  }
  return s + '</tbody></table>';
}
