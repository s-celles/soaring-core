// The four lift components, each a pure field: terrain and air in, numbers out.
// Namespaced rather than flattened — every field has its own tuning constants, and several
// share a name (GB, STEP, W_MIN) because they mean the same KIND of thing in different physics.
export * as grid from './grid';         // the sampling primitives: disc, lattice, blur, median
export * as ridge from './ridge';       // slope lift: w = wind·∇terrain
export * as converg from './converg';   // convergence: the divergence of the deflected flow
export * as wave from './wave';         // lee wave: the resonance λ = 2π·U/N
export * as thermal from './thermal';   // thermal potential: sun on ground → w*
export * as mix from './mix';           // the component registry and the simplex mixer
export * as calib from './calib';       // grounding the prediction in the day's real climbs
