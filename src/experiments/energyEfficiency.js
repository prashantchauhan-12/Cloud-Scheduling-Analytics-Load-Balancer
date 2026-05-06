/**
 * Experiment 2: Static Energy Efficiency
 * Replicating Figures 4, 5, 6 from Sun & Cho (IEEE Access 2022)
 * 
 * Compares the number of active PEs and static energy consumption
 * between DSEA and sEDF for light-weight and heavy-weight task sets.
 */

const { generateTaskSet, totalUtilization, minActivePEs } = require('../taskModel');
const { runSEDF } = require('../scheduler');
const { computeTotalEnergy, normalizedPECount, compareEnergy } = require('../energyModel');

/**
 * Run energy efficiency experiment.
 * 
 * Generates task sets classified into light (u_i ≤ 0.5) and heavy (u_i > 0.4)
 * utilization, then compares active PEs and energy consumption.
 * 
 * @param {object} config - Experiment configuration
 * @returns {object} Experiment results
 */
function runEnergyEfficiencyExperiment(config = {}) {
    const {
        utilizationLevels = [4, 8, 16, 24, 32],
        taskSetsPerLevel = 100,
        verbose = true
    } = config;

    const results = {
        utilizationLevels,
        
        // Figure 4: Required number of active PEs
        lightWeight: {
            dseaPEs: [],
            sedfPEs: [],
        },
        heavyWeight: {
            dseaPEs: [],
            sedfPEs: [],
        },
        
        // Figure 5: Normalized PE counts
        lightNormalized: {
            dseaNorm: [],
            sedfNorm: [],
        },
        heavyNormalized: {
            dseaNorm: [],
            sedfNorm: [],
        },

        // Figure 6: Static energy consumption
        lightEnergy: {
            dseaStatic: [],
            sedfStatic: [],
            dseaTotal: [],
            sedfTotal: [],
        },
        heavyEnergy: {
            dseaStatic: [],
            sedfStatic: [],
            dseaTotal: [],
            sedfTotal: [],
        },

        metadata: {
            taskSetsPerLevel,
            timestamp: new Date().toISOString()
        }
    };

    for (const targetUtil of utilizationLevels) {
        if (verbose) {
            process.stdout.write(`  Utilization ${targetUtil}: `);
        }

        // Accumulators for light-weight tasks
        let lightDseaPEs = 0, lightSedfPEs = 0;
        let lightDseaNorm = 0, lightSedfNorm = 0;
        let lightDseaStatic = 0, lightSedfStatic = 0;
        let lightDseaTotal = 0, lightSedfTotal = 0;
        let lightValid = 0;

        // Accumulators for heavy-weight tasks
        let heavyDseaPEs = 0, heavySedfPEs = 0;
        let heavyDseaNorm = 0, heavySedfNorm = 0;
        let heavyDseaStatic = 0, heavySedfStatic = 0;
        let heavyDseaTotal = 0, heavySedfTotal = 0;
        let heavyValid = 0;

        // --- Light-weight task sets ---
        for (let s = 0; s < taskSetsPerLevel; s++) {
            try {
                const tasks = generateTaskSet(targetUtil, { lightWeight: true });
                if (tasks.length < 2) continue;

                const totalUtil = totalUtilization(tasks);
                const dseaPE = minActivePEs(tasks); // DSEA uses ceil(U)
                const sedfResult = runSEDF(tasks);

                lightDseaPEs += dseaPE;
                lightSedfPEs += sedfResult.activePEs;
                lightDseaNorm += normalizedPECount(dseaPE, totalUtil);
                lightSedfNorm += normalizedPECount(sedfResult.activePEs, totalUtil);

                const energy = compareEnergy(dseaPE, sedfResult.activePEs, totalUtil);
                lightDseaStatic += energy.dsea.staticEnergy;
                lightSedfStatic += energy.sedf.staticEnergy;
                lightDseaTotal += energy.dsea.totalEnergy;
                lightSedfTotal += energy.sedf.totalEnergy;

                lightValid++;
            } catch (e) { continue; }
        }

        // --- Heavy-weight task sets ---
        for (let s = 0; s < taskSetsPerLevel; s++) {
            try {
                const tasks = generateTaskSet(targetUtil, { heavyWeight: true });
                if (tasks.length < 2) continue;

                const totalUtil = totalUtilization(tasks);
                const dseaPE = minActivePEs(tasks);
                const sedfResult = runSEDF(tasks);

                heavyDseaPEs += dseaPE;
                heavySedfPEs += sedfResult.activePEs;
                heavyDseaNorm += normalizedPECount(dseaPE, totalUtil);
                heavySedfNorm += normalizedPECount(sedfResult.activePEs, totalUtil);

                const energy = compareEnergy(dseaPE, sedfResult.activePEs, totalUtil);
                heavyDseaStatic += energy.dsea.staticEnergy;
                heavySedfStatic += energy.sedf.staticEnergy;
                heavyDseaTotal += energy.dsea.totalEnergy;
                heavySedfTotal += energy.sedf.totalEnergy;

                heavyValid++;
            } catch (e) { continue; }
        }

        // Store averages
        if (lightValid > 0) {
            results.lightWeight.dseaPEs.push(lightDseaPEs / lightValid);
            results.lightWeight.sedfPEs.push(lightSedfPEs / lightValid);
            results.lightNormalized.dseaNorm.push(lightDseaNorm / lightValid);
            results.lightNormalized.sedfNorm.push(lightSedfNorm / lightValid);
            results.lightEnergy.dseaStatic.push(lightDseaStatic / lightValid);
            results.lightEnergy.sedfStatic.push(lightSedfStatic / lightValid);
            results.lightEnergy.dseaTotal.push(lightDseaTotal / lightValid);
            results.lightEnergy.sedfTotal.push(lightSedfTotal / lightValid);
        }

        if (heavyValid > 0) {
            results.heavyWeight.dseaPEs.push(heavyDseaPEs / heavyValid);
            results.heavyWeight.sedfPEs.push(heavySedfPEs / heavyValid);
            results.heavyNormalized.dseaNorm.push(heavyDseaNorm / heavyValid);
            results.heavyNormalized.sedfNorm.push(heavySedfNorm / heavyValid);
            results.heavyEnergy.dseaStatic.push(heavyDseaStatic / heavyValid);
            results.heavyEnergy.sedfStatic.push(heavySedfStatic / heavyValid);
            results.heavyEnergy.dseaTotal.push(heavyDseaTotal / heavyValid);
            results.heavyEnergy.sedfTotal.push(heavySedfTotal / heavyValid);
        }

        if (verbose) {
            console.log(`done (L: ${lightValid}, H: ${heavyValid} valid sets)`);
            if (lightValid > 0) {
                const lPeRatio = (lightSedfPEs / lightValid) / (lightDseaPEs / lightValid);
                console.log(`    Light: DSEA=${(lightDseaPEs/lightValid).toFixed(1)} PEs, sEDF=${(lightSedfPEs/lightValid).toFixed(1)} PEs (${((lPeRatio-1)*100).toFixed(0)}% more)`);
            }
            if (heavyValid > 0) {
                const hPeRatio = (heavySedfPEs / heavyValid) / (heavyDseaPEs / heavyValid);
                console.log(`    Heavy: DSEA=${(heavyDseaPEs/heavyValid).toFixed(1)} PEs, sEDF=${(heavySedfPEs/heavyValid).toFixed(1)} PEs (${((hPeRatio-1)*100).toFixed(0)}% more)`);
            }
        }
    }

    return results;
}

module.exports = { runEnergyEfficiencyExperiment };
