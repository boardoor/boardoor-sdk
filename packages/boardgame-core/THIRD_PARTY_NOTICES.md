# Third-Party Notices

This package contains modified source from the components listed below. Exact immutable source
locations and modification summaries are also recorded in `EMBEDDED_COMPONENTS.json`.

## boardgame.io 0.50.2

Copyright (c) 2017 The boardgame.io Authors.

Source: https://github.com/boardgameio/boardgame.io/tree/2945c30e536517cf819e000f33d9d08bacaac297

Boardoor extracted and modified the engine, client, and AI implementation. Private server code is
not included in `@boardoor/core`. The dependency-free Boardoor Debug panel is a new implementation,
not a copy or compilation of boardgame.io's legacy Svelte Debug UI.

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the “Software”), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## seedrandom 3.0.5 / Alea

The random plugin contains an inlined and TypeScript-adapted version of Johannes Baagøe's Alea
implementation as distributed by David Bau's `seedrandom` project. Boardoor also exposes state
capture and restore for deterministic game and bot execution.

Source:
https://github.com/davidbau/seedrandom/blob/4460ad325a0a15273a211e509f03ae0beb99511a/lib/alea.js

Copyright (C) 2010 by Johannes Baagøe <baagoe@baagoe.org>

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
