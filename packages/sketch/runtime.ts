// The only module that imports p5 as a value. `loadSketchRuntime` imports it dynamically, so
// projects without sketch layers never fetch p5.
import p5 from 'p5'
import { createSketchRuntime } from './create'

export const runtime = createSketchRuntime(p5)
