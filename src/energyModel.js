/**
 * Energy Model for Cloud Computing
 * Based on: Section V-B of Sun & Cho (IEEE Access 2022)
 * 
 * Implements:
 *   - Static vs. Dynamic energy consumption model
 *   - Energy ratio: 75% dynamic, 25% static (as per paper)
 *   - Normalized energy computation for DSEA vs. sEDF
 */

/**
 * Default energy parameters as used in the paper
 */
const DEFAULT_ENERGY_PARAMS = {
    dynamicRatio: 0.75,    // 75% of total energy is dynamic
    staticRatio: 0.25,     // 25% of total energy is static
    peActivePower: 1.0,    // Normalized power per active PE
    peIdlePower: 0.3,      // Power consumption in idle state (30% of active)
    peSleepPower: 0.01,    // Power consumption in deep sleep (1% of active)
};

/**
 * Compute static energy consumption within a time interval.
 * 
 * Static energy = number of active PEs × static power × time
 * 
 * @param {number} activePEs - Number of active processing elements
 * @param {number} totalPEs - Total PEs in the system (for normalization)
 * @param {number} timeInterval - Length of the time interval
 * @param {object} params - Energy parameters
 * @returns {number} Static energy consumed
 */
function computeStaticEnergy(activePEs, totalPEs, timeInterval, params = DEFAULT_ENERGY_PARAMS) {
    // Active PEs consume full static power
    // Inactive PEs are shut down (DPM) and consume minimal power
    const activeEnergy = activePEs * params.peActivePower * params.staticRatio * timeInterval;
    const inactiveEnergy = (totalPEs - activePEs) * params.peSleepPower * params.staticRatio * timeInterval;
    
    return activeEnergy + inactiveEnergy;
}

/**
 * Compute dynamic energy consumption within a time interval.
 * Dynamic energy is proportional to actual computation performed.
 * 
 * @param {number} totalUtil - Total utilization of active tasks
 * @param {number} timeInterval - Length of the time interval
 * @param {object} params - Energy parameters
 * @returns {number} Dynamic energy consumed
 */
function computeDynamicEnergy(totalUtil, timeInterval, params = DEFAULT_ENERGY_PARAMS) {
    return totalUtil * params.peActivePower * params.dynamicRatio * timeInterval;
}

/**
 * Compute total energy consumption for a scheduling result.
 * 
 * @param {number} activePEs - Number of active PEs used by the scheduler
 * @param {number} totalUtil - Total utilization
 * @param {number} totalPEs - Total available PEs
 * @param {number} timeInterval - Time interval for measurement
 * @param {object} params - Energy parameters
 * @returns {object} Energy breakdown
 */
function computeTotalEnergy(activePEs, totalUtil, totalPEs, timeInterval = 1.0, params = DEFAULT_ENERGY_PARAMS) {
    const staticEnergy = computeStaticEnergy(activePEs, totalPEs, timeInterval, params);
    const dynamicEnergy = computeDynamicEnergy(totalUtil, timeInterval, params);
    
    return {
        staticEnergy,
        dynamicEnergy,
        totalEnergy: staticEnergy + dynamicEnergy,
        activePEs,
        totalPEs,
        utilization: totalUtil
    };
}

/**
 * Compare energy consumption between DSEA and sEDF.
 * 
 * DSEA minimizes active PEs to ceil(U), while sEDF uses bin-packing
 * which typically requires more PEs.
 * 
 * @param {number} dseaPEs - Active PEs for DSEA
 * @param {number} sedfPEs - Active PEs for sEDF
 * @param {number} totalUtil - Total utilization
 * @param {number} timeInterval - Time interval
 * @returns {object} Energy comparison
 */
function compareEnergy(dseaPEs, sedfPEs, totalUtil, timeInterval = 1.0) {
    const totalPEs = Math.max(dseaPEs, sedfPEs) + 10; // Some buffer PEs

    const dseaEnergy = computeTotalEnergy(dseaPEs, totalUtil, totalPEs, timeInterval);
    const sedfEnergy = computeTotalEnergy(sedfPEs, totalUtil, totalPEs, timeInterval);

    return {
        dsea: dseaEnergy,
        sedf: sedfEnergy,
        staticSavings: (sedfEnergy.staticEnergy - dseaEnergy.staticEnergy) / sedfEnergy.staticEnergy * 100,
        totalSavings: (sedfEnergy.totalEnergy - dseaEnergy.totalEnergy) / sedfEnergy.totalEnergy * 100
    };
}

/**
 * Compute normalized PE count (ratio of active PEs to total utilization)
 * As shown in Figure 5 of the paper.
 */
function normalizedPECount(activePEs, totalUtil) {
    if (totalUtil <= 0) return 0;
    return activePEs / totalUtil;
}

module.exports = {
    DEFAULT_ENERGY_PARAMS,
    computeStaticEnergy,
    computeDynamicEnergy,
    computeTotalEnergy,
    compareEnergy,
    normalizedPECount
};
