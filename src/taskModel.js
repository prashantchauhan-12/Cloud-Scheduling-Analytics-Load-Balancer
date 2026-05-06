/**
 * Task Model for Real-Time Cloud Scheduling
 * Based on: "A Lightweight Optimal Scheduling Algorithm for Energy-Efficient 
 *            and Real-Time Cloud Services" (Sun & Cho, IEEE Access 2022)
 * 
 * Implements:
 *   - Periodic real-time task model (Section III-A)
 *   - RT-VM model (Section III-B)
 *   - Task set generation (Section V-A)
 *   - Temporal boundary & window computation
 */

/**
 * Represents a periodic real-time task τ_i
 * with implicit deadline (D_i = T_i)
 */
class RealTimeTask {
    /**
     * @param {number} id - Task identifier
     * @param {number} period - Period T_i (ms)
     * @param {number} wcet - Worst-case execution time C_i (ms)
     */
    constructor(id, period, wcet) {
        this.id = id;
        this.period = period;       // T_i
        this.wcet = wcet;           // C_i
        this.utilization = wcet / period; // u_i = C_i / T_i
    }

    getActiveJob(t) {
        // If period is not set (e.g. from socket.io payload), try to use the raw properties
        const period = this.period || 100; // default to 100ms if not provided
        const wcet = this.wcet || this.executionTime || 10;
        
        const jobIndex = Math.floor(t / period);
        const arrivalTime = jobIndex * period;       // a_i(t)
        const absoluteDeadline = (jobIndex + 1) * period; // d_i(t) = a_i(t) + T_i
        const remainingExec = wcet;                  // c_i(t) = C_i (worst case)
        return {
            taskId: this.id,
            arrivalTime,
            absoluteDeadline,
            remainingExec,
            utilization: this.utilization || (wcet / period),
            period: period,
            wcet: wcet
        };
    }
}

/**
 * Represents a Real-Time Virtual Machine (RT-VM)
 * As defined in Section III-B and Kim et al. [9]
 */
class RTVirtualMachine {
    /**
     * @param {number} id - VM identifier
     * @param {number} utilization - u_i: CPU utilization required
     * @param {number} mips - m_i: Million Instructions Per Second rate
     * @param {number} period - T_i: period for deadline computation
     * @param {number} wcet - C_i: worst-case execution time
     */
    constructor(id, utilization, mips, period, wcet) {
        this.id = id;
        this.utilization = utilization;
        this.mips = mips;
        this.period = period;
        this.wcet = wcet;
    }
}

/**
 * Generate a set of random real-time tasks as described in Section V-A.
 * 
 * Period: uniform random in [1, 100] ms
 * WCET: random value from 0.1 to 1.0 times its period
 * Tasks are generated until total utilization reaches [targetUtil-1, targetUtil)
 * 
 * @param {number} targetUtil - Target total utilization (= number of required PEs)
 * @param {object} options - Generation options
 * @returns {RealTimeTask[]} Array of generated tasks
 */
function generateTaskSet(targetUtil, options = {}) {
    const {
        minPeriod = 1,
        maxPeriod = 100,
        minUtilRatio = 0.1,
        maxUtilRatio = 1.0,
        lightWeight = false, // u_i ≤ 0.5
        heavyWeight = false  // u_i > 0.4
    } = options;

    const tasks = [];
    let totalUtil = 0;
    let id = 0;

    while (totalUtil < targetUtil - 1) {
        const period = Math.floor(Math.random() * (maxPeriod - minPeriod + 1)) + minPeriod;
        
        let utilRatio;
        if (lightWeight) {
            // Light utilization: u_i ≤ 0.5
            utilRatio = Math.random() * 0.5 * (maxUtilRatio - minUtilRatio) + minUtilRatio;
            utilRatio = Math.min(utilRatio, 0.5);
        } else if (heavyWeight) {
            // Heavy utilization: u_i > 0.4
            utilRatio = Math.random() * (maxUtilRatio - 0.4) + 0.4;
        } else {
            utilRatio = Math.random() * (maxUtilRatio - minUtilRatio) + minUtilRatio;
        }

        const wcet = Math.max(1, Math.round(period * utilRatio * 100) / 100);
        const actualUtil = wcet / period;

        // Don't exceed target
        if (totalUtil + actualUtil >= targetUtil) {
            // Try to fit one more task that gets us close
            const remaining = targetUtil - totalUtil - 0.01;
            if (remaining > 0.05) {
                const lastWcet = Math.max(1, Math.round(period * remaining * 100) / 100);
                if (lastWcet > 0 && lastWcet <= period) {
                    tasks.push(new RealTimeTask(id++, period, lastWcet));
                    totalUtil += lastWcet / period;
                }
            }
            break;
        }

        tasks.push(new RealTimeTask(id++, period, wcet));
        totalUtil += actualUtil;
    }

    return tasks;
}

/**
 * Compute temporal boundaries B = {b_0, b_1, ..., b_K} at time t.
 * B contains:
 *   - current time t
 *   - all release times within [t, d_max(t)]
 *   - all absolute deadlines within [t, d_max(t)]
 * Sorted in increasing order.
 * 
 * @param {RealTimeTask[]} tasks - Set of real-time tasks
 * @param {number} t - Current time
 * @returns {{ boundaries: number[], windows: object[] }}
 */
function computeBoundaries(tasks, t) {
    // Get active jobs, falling back to class prototype if it's a generic object
    const activeJobs = tasks.map(task => {
        if (typeof task.getActiveJob === 'function') {
            return task.getActiveJob(t);
        } else {
            return RealTimeTask.prototype.getActiveJob.call(task, t);
        }
    });
    
    // Find d_max(t) = largest deadline
    const dMax = Math.max(...activeJobs.map(j => j.absoluteDeadline));

    // Collect all boundary points in [t, d_max]
    const boundarySet = new Set();
    boundarySet.add(t);

    for (const task of tasks) {
        // Fallback for period if it doesn't exist on standard tasks
        const period = task.period || 100;
        
        // Add all release times and deadlines within [t, dMax]
        let releaseTime = Math.ceil(t / period) * period;
        while (releaseTime <= dMax) {
            boundarySet.add(releaseTime);
            releaseTime += period;
        }
        let deadline = Math.ceil(t / period) * period;
        if (deadline === t) deadline += period;
        while (deadline <= dMax) {
            boundarySet.add(deadline);
            deadline += period;
        }
    }

    // Sort boundaries
    const boundaries = Array.from(boundarySet).sort((a, b) => a - b);

    // Compute windows W_k = [b_k, b_{k+1}] with length l_k
    const windows = [];
    for (let k = 0; k < boundaries.length - 1; k++) {
        const start = boundaries[k];
        const end = boundaries[k + 1];
        windows.push({
            index: k,
            start,
            end,
            length: end - start  // l_k = b_{k+1} - b_k
        });
    }

    return { boundaries, windows, activeJobs, dMax };
}

/**
 * Get active job indices for a given window W_k.
 * J_RT(k,t) = {i | W_k ⊂ [a_i(t), d_i(t)]}
 * 
 * @param {object[]} activeJobs - Array of active job info
 * @param {object} window - Window {start, end}
 * @returns {number[]} Indices of active jobs in this window
 */
function getActiveJobIndices(activeJobs, window) {
    const indices = [];
    for (let i = 0; i < activeJobs.length; i++) {
        const job = activeJobs[i];
        if (window.start >= job.arrivalTime && window.end <= job.absoluteDeadline) {
            indices.push(i);
        }
    }
    return indices;
}

/**
 * Compute total utilization of a task set
 */
function totalUtilization(tasks) {
    return tasks.reduce((sum, t) => sum + t.utilization, 0);
}

/**
 * Compute the minimum number of active PEs needed (ceiling of total utilization)
 */
function minActivePEs(tasks) {
    return Math.ceil(totalUtilization(tasks));
}

module.exports = {
    RealTimeTask,
    RTVirtualMachine,
    generateTaskSet,
    computeBoundaries,
    getActiveJobIndices,
    totalUtilization,
    minActivePEs
};
