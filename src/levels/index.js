// The four levels in play order, in the shape the contract describes (cells, things, legend).
// Level files are written as one `map`; see build.js for the authoring format.

import { build } from './build.js';
import l1 from './l1.js';
import l2 from './l2.js';
import l3 from './l3.js';
import l4 from './l4.js';

export default [l1, l2, l3, l4].map(build);
