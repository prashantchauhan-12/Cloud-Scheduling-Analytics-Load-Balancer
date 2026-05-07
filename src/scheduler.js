/**
 * Scheduler — Orchestrates flow network construction and solver invocation
 * Based on: Sections IV and V of Sun & Cho (IEEE Access 2022)
 * 
 * Implements:
 *   - DSEA scheduling (RT-optimal, energy-efficient)
 *   - sEDF scheduling (baseline comparison for energy efficiency)
 *   - PE allocation using McNaughton wrap-around
 */

const { computeBoundaries, getActiveJobIndices, totalUtilization, minActivePEs } = require('./taskModel');
const { constructCombinedFlowNetwork, constructPreviousFlowNetwork } = require('./flowNetwork');
const { dseaSolver, bfsSolver } = require('./dseaSolver');

/**
 * Run the DSEA scheduling algorithm at a given time point.
 * 
 * @param {RealTimeTask[]} tasks - Set of real-time tasks
 * @param {number} t - Current time (typically 0 for critical instant)
 * @param {string} mode - 'CF' or 'CB'
 * @returns {object} Scheduling result with flow assignments and timing
 */
function runDSEA(tasks, t = 0, mode = 'CF') {
    // Step 1: Compute boundaries and windows
    const { boundaries, windows, activeJobs } = computeBoundaries(tasks, t);
    const totalUtil = totalUtilization(tasks);

    // Step 2: Construct combined flow network
    const network = constructCombinedFlowNetwork(activeJobs, windows, totalUtil);

    // Step 3: Run DSEA solver
    const result = dseaSolver(network, activeJobs, windows, mode);

    // Step 4: Compute active PEs (ceiling of total utilization)
    const activePEs = minActivePEs(tasks);

    return {
        ...result,
        activePEs,
        totalUtil,
        numTasks: tasks.length,
        numWindows: windows.length,
        numBoundaries: boundaries.length,
        mode
    };
}

/**
 * Run the previous BFS-based scheduling algorithm at a given time point.
 * This is the baseline for time complexity comparison.
 * 
 * @param {RealTimeTask[]} tasks - Set of real-time tasks
 * @param {number} t - Current time
 * @returns {object} Scheduling result
 */
function runBFS(tasks, t = 0) {
    const { boundaries, windows, activeJobs } = computeBoundaries(tasks, t);
    const totalUtil = totalUtilization(tasks);

    // Construct the previous (simpler) flow network
    const network = constructPreviousFlowNetwork(activeJobs, windows, totalUtil);

    // Run BFS solver (Edmonds-Karp)
    const result = bfsSolver(network, activeJobs);
    const activePEs = minActivePEs(tasks);

    return {
        ...result,
        activePEs,
        totalUtil,
        numTasks: tasks.length,
        numWindows: windows.length,
        numBoundaries: boundaries.length
    };
}

/**
 * Simulate sEDF (simple Earliest Deadline First) scheduling.
 * 
 * sEDF allocates RT-VMs to PEs one by one, each PE's total utilization ≤ 1.0.
 * This is the bin-packing approach used by the Xen sEDF scheduler.
 * It does NOT guarantee RT-optimality on multiprocessors because
 * migration is not allowed after assignment.
 * 
 * @param {RealTimeTask[]} tasks - Set of real-time tasks
 * @returns {object} sEDF scheduling result with PE count
 */
function runSEDF(tasks) {
    // Sort tasks by utilization descending (First-Fit Decreasing bin packing)
    const sortedTasks = [...tasks].sort((a, b) => b.utilization - a.utilization);
    
    const pes = []; // Each PE tracks its current total utilization

    for (const task of sortedTasks) {
        let assigned = false;

        // Try to fit into existing PE (First-Fit)
        for (let p = 0; p < pes.length; p++) {
            if (pes[p].totalUtil + task.utilization <= 1.0 + 1e-9) {
                pes[p].totalUtil += task.utilization;
                pes[p].tasks.push(task);
                assigned = true;
                break;
            }
        }

        // Need a new PE
        if (!assigned) {
            pes.push({
                totalUtil: task.utilization,
                tasks: [task]
            });
        }
    }

    const totalUtil = totalUtilization(tasks);

    return {
        activePEs: pes.length,
        totalUtil,
        numTasks: tasks.length,
        peDetails: pes.map(pe => ({
            numTasks: pe.tasks.length,
            utilization: pe.totalUtil
        }))
    };
}

/**
 * Compare DSEA and sEDF for a given task set.
 * Returns metrics for both approaches.
 */
function compareSchedulers(tasks) {
    const dseaResult = runDSEA(tasks, 0, 'CF');
    const sedfResult = runSEDF(tasks);

    return {
        dsea: {
            activePEs: dseaResult.activePEs,
            totalUtil: dseaResult.totalUtil,
            elapsed: dseaResult.elapsed,
            migrationDelay: Math.max(0, dseaResult.activePEs - 1) * 2 // 2ms delay per McNaughton wrap-around migration
        },
        sedf: {
            activePEs: sedfResult.activePEs,
            totalUtil: sedfResult.totalUtil,
            migrationDelay: 0 // sEDF bins tasks permanently, so no migrations
        },
        peDifference: sedfResult.activePEs - dseaResult.activePEs,
        peRatio: sedfResult.activePEs / dseaResult.activePEs
    };
}

module.exports = {
    runDSEA,
    runBFS,
    runSEDF,
    compareSchedulers
};
