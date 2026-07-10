// Accessors so views/calc never read the raw state shape directly.
// This is what makes multi-vehicle additive later.

export const activeEntries = (car) => (car.entries || []).filter((e) => !e.deletedAt);

export const getActiveCar = (state) =>
  state.cars.find((c) => c.id === state.activeCarId) || state.cars[0];
