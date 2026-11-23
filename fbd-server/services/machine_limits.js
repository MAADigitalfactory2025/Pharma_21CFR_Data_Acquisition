/**
 * Reusable statistical-limit engine for every machine type.
 * Independent scope: machineTag + product/recipe + parameter.
 * No database writes or machine control in this file.
 * Add future machine parameters ONLY in the marked class definitions.
 */
'use strict';
const FBD_PARAMETERS = Object.freeze({
  inletTemp: '°C', outletTemp: '°C', productTemp: '°C',
  airflow: 'm³/h', diffPressure: 'Pa', inletHumidity: '%RH', blowerSpeed: 'RPM',
});
class MachineLimits {
  constructor({ machineTag, machineType, parameters = {}, minimumSamples = 30,
    toleranceFactor = 0.20, minimumAbsoluteTolerance = 0 }) {
    if (!machineTag) throw new Error('Unique machineTag is required');
    this.machineTag = machineTag;
    this.machineType = machineType;
    this.parameters = Object.freeze({ ...parameters });
    this.minimumSamples = minimumSamples;
    this.toleranceFactor = toleranceFactor;
    this.minimumAbsoluteTolerance = minimumAbsoluteTolerance;
  }
  /** Approved, prior observations ONLY. Caller filters machine, recipe, and parameter. */
  calculate(parameter, historicalValues, currentValue, absolute = null) {
    if (!Object.hasOwn(this.parameters, parameter)) return { status: 'UNCONFIGURED' };
    const history = historicalValues.filter(v => typeof v === 'number' && Number.isFinite(v));
    const result = { machineTag: this.machineTag, parameter, sampleCount: history.length,
      lowerDynamicLimit: null, upperDynamicLimit: null, status: 'INSUFFICIENT_HISTORY',
      absolute: absolute ? { lower: absolute.lower, upper: absolute.upper, version: absolute.version } : null };
    if (history.length < this.minimumSamples) return result;
    const mean = history.reduce((sum, value) => sum + value, 0) / history.length;
    const tolerance = Math.max(Math.abs(mean) * this.toleranceFactor, this.minimumAbsoluteTolerance);
    result.lowerDynamicLimit = mean - tolerance;
    result.upperDynamicLimit = mean + tolerance;
    result.status = typeof currentValue !== 'number' || !Number.isFinite(currentValue)
      ? 'NO_READING'
      : (currentValue < result.lowerDynamicLimit || currentValue > result.upperDynamicLimit)
        ? 'STATISTICAL_ANOMALY' : 'NORMAL';
    if (absolute && Number.isFinite(currentValue) &&
        (currentValue < absolute.lower || currentValue > absolute.upper)) {
      result.absoluteStatus = 'ABSOLUTE_LIMIT_EXCEEDED';
    }
    return result;
  }
}
class FBDLimits extends MachineLimits {
  constructor(tag) { super({ machineTag: tag, machineType: 'FBD', parameters: FBD_PARAMETERS }); }
}
class RMGLimits extends MachineLimits {
  constructor(tag) { super({ machineTag: tag, machineType: 'RMG', parameters: {
    // TODO RMG-150: paste approved RMG parameter IDs and units here.
  } }); }
}
class CoatingPanelLimits extends MachineLimits {
  constructor(tag) { super({ machineTag: tag, machineType: 'COATING', parameters: {
    // TODO Coating Panel 18/36: paste approved parameter IDs and units here.
  } }); }
}
class ContaBlenderLimits extends MachineLimits {
  constructor(tag) { super({ machineTag: tag, machineType: 'CONTA', parameters: {
    // TODO Conta Blender 150/350: paste approved parameter IDs and units here.
  } }); }
}
class APCGLimits extends MachineLimits {
  constructor(tag) { super({ machineTag: tag, machineType: 'APCG', parameters: {
    // TODO APCG-300C/FBB-300: paste approved parameter IDs and units here.
  } }); }
}
class FBD5KG extends FBDLimits { constructor() { super('FBD-5-01'); } }
class FBD10KG extends FBDLimits { constructor() { super('FBD-10-01'); } }
class FBD450KG extends FBDLimits { constructor() { super('FBD-450-01'); } }
class RMG150 extends RMGLimits { constructor() { super('M004'); } }
class CoatingPanel18 extends CoatingPanelLimits { constructor() { super('M005'); } }
class CoatingPanel36 extends CoatingPanelLimits { constructor() { super('M006'); } }
class ContaBlender150 extends ContaBlenderLimits { constructor() { super('M007'); } }
class ContaBlender350 extends ContaBlenderLimits { constructor() { super('M008'); } }
class APCG300 extends APCGLimits { constructor() { super('M009'); } }
const registry = Object.freeze({
  'FBD-5': FBD5KG, 'FBD-10': FBD10KG, 'FBD-450': FBD450KG,
  'RMG-150': RMG150, 'COATING-18': CoatingPanel18, 'COATING-36': CoatingPanel36,
  'CONTA-150': ContaBlender150, 'CONTA-350': ContaBlender350, 'APCG-300': APCG300,
});
function forMachine(machine) {
  const Type = registry[machine.model];
  if (!Type) return null;
  const instance = new Type();
  // Actual unique machine tag always wins; do not share histories between units.
  instance.machineTag = machine.tag;
  return instance;
}
module.exports = { MachineLimits, FBDLimits, RMGLimits, CoatingPanelLimits,
  ContaBlenderLimits, APCGLimits, FBD5KG, FBD10KG, FBD450KG, RMG150,
  CoatingPanel18, CoatingPanel36, ContaBlender150, ContaBlender350, APCG300,
  forMachine, FBD_PARAMETERS };
