/**
 * Experiment 1: Time Complexity Comparison
 * Replicating Figure 3 from Sun & Cho (IEEE Access 2022)
 * 
 * Compares elapsed time of DSEA solver (O(N²)) vs. BFS solver (O(N³))
 * for finding feasible solutions across varying task set sizes.
 */

const { generateTaskSet, computeBoundaries, totalUtilization } = require('../taskModel');
const { constructCombinedFlowNetwork, constructPreviousFlowNetwork } = require('../flowNetwork');
const { dseaSolver, bfsSolver } = require('../dseaSolver');

/**
 * Run time complexity experiment.
 * 
 * Generates multiple task sets for each target utilization level and
 * measures the average time to find a feasible solution.
 * 
 * @param {object} config - Experiment configuration
 * @returns {object} Experiment results
 */
function runTimeComplexityExperiment(config = {}) {
    const {
        utilizationLevels = [4, 8, 16, 24, 32],
        taskSetsPerLevel = 50,
        verbose = true
    } = config;

    const results = {
        utilizationLevels,
        dseaCF: [],     // DSEA ClusterForward times
        dseaCB: [],     // DSEA ClusterBackward times
        bfs: [],        // BFS solver times
        taskCounts: [], // Average N for each level
        metadata: {
            taskSetsPerLevel,
            timestamp: new Date().toISOString()
        }
    };

    for (const targetUtil of utilizationLevels) {
        if (verbose) {
            process.stdout.write(`  Utilization ${targetUtil}: `);
        }

        let totalTimeDSEA_CF = 0;
        let totalTimeDSEA_CB = 0;
        let totalTimeBFS = 0;
        let totalTasks = 0;
        let validSets = 0;
        let minN = Infinity, maxN = 0;

        for (let s = 0; s < taskSetsPerLevel; s++) {
            try {
                const tasks = generateTaskSet(targetUtil);
                if (tasks.length < 2) continue;

                const N = tasks.length;
                minN = Math.min(minN, N);
                maxN = Math.max(maxN, N);
                totalTasks += N;

                const t = 0; // Critical instant
                const { windows, activeJobs } = computeBoundaries(tasks, t);
                const totalUtil = totalUtilization(tasks);

                // --- DSEA CF ---
                const networkCF = constructCombinedFlowNetwork(activeJobs, windows, totalUtil);
                const resultCF = dseaSolver(networkCF, activeJobs, windows, 'CF');
                totalTimeDSEA_CF += resultCF.elapsed;

                // --- DSEA CB ---
                const networkCB = constructCombinedFlowNetwork(activeJobs, windows, totalUtil);
                const resultCB = dseaSolver(networkCB, activeJobs, windows, 'CB');
                totalTimeDSEA_CB += resultCB.elapsed;

                // --- BFS baseline ---
                const networkBFS = constructPreviousFlowNetwork(activeJobs, windows, totalUtil);
                const resultBFS = bfsSolver(networkBFS, activeJobs);
                totalTimeBFS += resultBFS.elapsed;

                validSets++;

                if (verbose && (s + 1) % 10 === 0) {
                    process.stdout.write('.');
                }
            } catch (e) {
                // Skip invalid task sets
                continue;
            }
        }

        if (validSets > 0) {
            const avgCF = totalTimeDSEA_CF / validSets;
            const avgCB = totalTimeDSEA_CB / validSets;
            const avgBFS = totalTimeBFS / validSets;
            const avgN = totalTasks / validSets;

            results.dseaCF.push(avgCF);
            results.dseaCB.push(avgCB);
            results.bfs.push(avgBFS);
            results.taskCounts.push({
                avg: Math.round(avgN),
                min: minN,
                max: maxN
            });

            if (verbose) {
                console.log(` done (${validSets} sets, N: ${minN}-${maxN})`);
                console.log(`    DSEA-CF: ${avgCF.toFixed(3)}ms | DSEA-CB: ${avgCB.toFixed(3)}ms | BFS: ${avgBFS.toFixed(3)}ms | Speedup: ${(avgBFS/avgCF).toFixed(1)}x`);
            }
        } else {
            results.dseaCF.push(0);
            results.dseaCB.push(0);
            results.bfs.push(0);
            results.taskCounts.push({ avg: 0, min: 0, max: 0 });
            if (verbose) console.log(' no valid sets');
        }
    }

    return results;
}

module.exports = { runTimeComplexityExperiment };
