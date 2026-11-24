# TinClay

TinClay is a spatial engineering worksheet where named variables live on a grid and derived values update from MATLAB-style formulas.

## Download for Windows

Download the Windows x64 installer or standalone executable from
[GitHub Releases](https://github.com/LucasLavalleeMA/TinClay/releases).
The app requires the Microsoft Edge WebView2 Runtime; the installer can download
it if needed. The executables are not code-signed, so Windows SmartScreen may
show a warning.

## Features

- Reactive scalar, vector, and matrix variables evaluated with Math.js.
- Directed dependency graph with cycle and missing-variable errors.
- Spreadsheet-style editable grid, formula bar, number formats, units, and undo/redo.
- Variable-wide alignment, per-cell typography, colors and borders, plus light, dark and system themes.
- Multi-variable dragging and adjustable column widths.
- Numeric CSV import/export and tabular numeric clipboard paste.
- Default kinetic-energy example with a linked velocity/energy plot.
- `.clay` workspace save/load in a browser or Tauri desktop window.

Select a grid cell to use the formula bar. Enter a name, `symbol = value` or
`symbol = expression` in an empty cell to create a variable. A name alone
creates an unfilled variable; formulas referencing it report an error until a
value is entered. A number alone creates an automatically named variable. Type
directly in an empty grid cell or blank value; the formula bar mirrors the draft.
Press Enter to commit or Escape to cancel. Spaces in names become underscores in symbols. Prefix a
root value with `=` to turn it into a derived variable. Edit any derived value
in the grid (or enter a number in the formula bar) to keep the current results
as editable values and replace that cell. Use `=` for a constant formula.
While editing a formula in the formula bar or a new grid cell, click an existing
variable to insert its symbol at the cursor without leaving the formula.
Drag the selected variable's bottom-right corner to resize its rows and columns;
the corner can also be focused and resized with the arrow keys. Shrinking
removes values outside the new dimensions. When existing values in a row or
column form an arithmetic sequence of at least two filled numbers, expansion
continues that sequence. Other new cells are zero once the variable has a value.
Resizing a derived variable first keeps its current results as
editable values. Neighboring blocks move to make room.
Double-click a
variable header to edit its name, symbol, and unit; press Escape to cancel or
drag the header to move
the variable. Select cells from several variables, then drag one of their
headers to move them together. Drag a column header's right edge to change its
width. Hold Ctrl (Cmd on macOS) while selecting to select cells rather than
dragging a variable header. Cell formatting and column widths are saved in `.clay` workspaces and
support undo/redo. Alignment applies to the entire selected variable, including
cells added later; alignment on empty cells and other formatting apply to the
selected cells. Clearing formatting resets alignment for touched variables.
Numbers are right-aligned by default unless a variable's alignment or decimal
alignment is set.
Select all or outside borders and a line style and color in the ribbon. Explicit
borders, including No borders, replace the default variable outline on those cells.
At most 250,000 cells can be formatted in one operation. Use Clear format to
restore the defaults. The Theme menu controls the local light/dark/system
preference. Light mode pairs a bright worksheet with a dark ribbon and formula
bar; dark mode also darkens the worksheet. Edit the `+` cell below a root column vector to append a value.
Delete or Backspace clears selected values and their cell formatting, including
formatting on empty cells; selecting a variable's header deletes the whole
variable and its formatting. Clearing a cell also resets its variable's alignment.
The ribbon's Delete variable command also removes the
selected variable. Clearing a derived value keeps the current results as root
values. Cleared cells remain blank, not zero; dependent formulas and plots need
the missing values filled before they can calculate. Deleting a variable clears
its plot selections and leaves dependent formulas showing a missing-variable
error. These changes can be undone. Plots are floating grid objects:
use their title bar to move them, their lower-right corner to resize them, and
their X/Y selectors to choose variables. Open the gear button on a plot for its
settings panel. Choose line, scatter, bar, histogram, box, area, heatmap, contour,
or 3D surface; adjust axes, scales, limits, labels, grid, colors, line and marker
styles, opacity, and chart-specific options. Add extra Y series for non-matrix
charts. Line, scatter, area, and bar charts pair each Y with the common X vector
or use one-based indices when X is None; paired vectors must have equal lengths.
Histograms and box plots use Y values as samples, while matrix charts use the Y
variable as a matrix with one-based row and column coordinates. Logarithmic
axes require positive plotted values. Axis limits are automatic
when blank; enter both minimum and maximum for manual limits. Plot settings and
series support undo/redo and are saved in `.clay` files;
older files without plots open without any charts.
Use Undo/Redo in the ribbon, or Ctrl+Z and Ctrl+Y (Cmd+Z and Cmd+Shift+Z on
macOS) while the grid is focused, to reverse or restore workspace changes.
Text inputs retain their normal text undo. A paste is one undo step.

## Spreadsheet functions

Enter `=AVERAGE(v, Trials)` in an empty cell to create a named formula block,
or use an assignment such as `MeanSpeed = MEAN(v)`. Function names are
case-insensitive. Aggregates combine all numeric elements of every scalar,
vector, or matrix argument (rather than averaging each variable separately):

- `SUM`, `PRODUCT`, `COUNT`, `MIN`, `MAX`, `AVERAGE` / `MEAN` / `AVG`, `MEDIAN`
- `STDEV` / `STDDEV` / `STDEV.S` / `STDDEV.S` and `VAR` / `VAR.S` use sample statistics (at least two values).
- `STDEVP` / `STDDEVP` / `STDEV.P` / `STDDEV.P` and `VARP` / `VAR.P` use population statistics.
- `ABS`, `SQRT`, `POWER`, `MOD`, `ROUND`, `ROUNDUP`, `ROUNDDOWN`, `PI`,
  `EXP`, `LN`, `LOG10`, `SIN`, `COS`, `TAN`, `ASIN`, `ACOS`, and `ATAN`.

`TRIM(data, startindex, endindex)` selects an inclusive range using one-based
positive integer indices. For example, `TRIM(v, 2, 4)` returns the second
through fourth values of `v`. It selects elements from vectors and rows from
matrices; a single-row array is treated as a row vector. A scalar can only
be trimmed with indices `1, 1`. Invalid or out-of-range indices report an error.

Overlapping Math.js aggregate names such as `sum` and `mean` use these
spreadsheet semantics, so a second argument is another value, not a dimension.
Use `MATSUM(matrix, dimension)` or `MATMEAN(matrix, dimension)` for Math.js
dimension-based reductions (dimensions are one-based in expressions).
Formulas reference variable symbols, not Excel cell addresses or ranges.
While entering a formula, type at least two letters of a function to see
suggestions. Use the arrow keys and Enter, Tab, or a click to insert one.

## Development

Requires Node.js 20.19+ and npm.

```sh
npm install
npm run dev
npm test
npm run build
```

For native builds, install the prerequisites for [Tauri v2](https://v2.tauri.app/start/prerequisites/), then run:

```sh
npm run tauri:build
```

Pushing a `v`-prefixed version tag builds the Windows x64 executable and NSIS
installer and publishes them to GitHub Releases. The tag must match the versions
in the npm, Cargo, and Tauri configuration files.

The web build is written to `dist/`. Native build output is generated under `src-tauri/target/` and is not committed.
The source application icon is `public/tinclay.png`; regenerate the desktop
icons with `npm run tauri -- icon public/tinclay.png`.

TinClay is distributed under the MIT License. Third-party dependencies retain their respective licenses.
