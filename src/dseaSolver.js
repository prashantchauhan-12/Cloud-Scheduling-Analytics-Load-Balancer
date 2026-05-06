/**
 * DSEA Solver — Dedicated Search Energy-Aware Algorithm
 * Based on: Algorithm 1 in Section IV-B of Sun & Cho (IEEE Access 2022)
 * 
 * Implements:
 *   - DSEA solver with ClusterForward (CF) and ClusterBackward (CB) modes
 *   - Traditional BFS-based solver (Edmonds-Karp) for baseline comparison
 *   - O(N²) complexity for DSEA vs. O(N³) for BFS baseline
 */

/**
 * DSEA Solver (Algorithm 1)
 * 
 * Finds a feasible solution by visiting each edge only once.
 * Two modes:
 *   - CF (ClusterForward): Tasks ordered by earliest deadline, windows front-to-back
 *     → Clusters tasks at beginning of AJA, idle time at end
 *   - CB (ClusterBackward): Tasks ordered by latest deadline, windows back-to-front
 *     → Clusters tasks at end of AJA, idle time at beginning
 * 
 * @param {FlowNetwork} network - The combined flow network
 * @param {object[]} activeJobs - Active jobs for ordering
 * @param {object[]} windows - Time windows for ordering
 * @param {string} mode - 'CF' or 'CB'
 * @returns {{ maxFlow: number, elapsed: number }}
 */
function dseaSolver(network, activeJobs, windows, mode = 'CF') {
    const startTime = performance.now();
    
    const N = activeJobs.length;
    const K = windows.length;

    // Compute target max flow = Σ c_i(t)
    const targetFlow = activeJobs.reduce((sum, job) => sum + job.remainingExec, 0);
    
    // Sort tasks by deadline based on mode
    const taskOrder = activeJobs.map((job, i) => ({ index: i, deadline: job.absoluteDeadline }));
    if (mode === 'CF') {
        // ClusterForward: earliest deadline first
        taskOrder.sort((a, b) => a.deadline - b.deadline);
    } else {
        // ClusterBackward: latest deadline first
        taskOrder.sort((a, b) => b.deadline - a.deadline);
    }

    // Window order based on mode
    const windowOrder = windows.map((w, k) => k);
    if (mode === 'CB') {
        windowOrder.reverse(); // Back-to-front
    }

    let maxFlow = 0;

    // Algorithm 1: Main loop - for each task in order
    for (const taskInfo of taskOrder) {
        const i = taskInfo.index;
        const taskNodeId = `task_${i}`;
        
        // Get source -> task edge
        const sourceEdges = network.getEdges('source');
        const sourceToTask = sourceEdges.find(e => e.to === taskNodeId && e.residualCapacity > 0);
        if (!sourceToTask) continue;

        // Visit windows in order (front or back)
        for (const k of windowOrder) {
            if (sourceToTask.residualCapacity <= 1e-9) break;

            // Try RT window edge: task_i -> wrt_k
            const taskEdges = network.getEdges(taskNodeId);
            const rtEdge = taskEdges.find(e => e.to === `wrt_${k}` && e.residualCapacity > 0);
            
            if (rtEdge) {
                // Find wrt_k -> sink edge
                const wrtEdges = network.getEdges(`wrt_${k}`);
                const sinkEdge = wrtEdges.find(e => e.to === 'sink' && e.residualCapacity > 0);
                
                if (sinkEdge) {
                    // Bottleneck = min capacity along the path
                    const bottleneck = Math.min(
                        sourceToTask.residualCapacity,
                        rtEdge.residualCapacity,
                        sinkEdge.residualCapacity
                    );

                    if (bottleneck > 1e-9) {
                        // Push flow along the augmenting path
                        sourceToTask.flow += bottleneck;
                        sourceToTask.reverseEdge.flow -= bottleneck;
                        rtEdge.flow += bottleneck;
                        rtEdge.reverseEdge.flow -= bottleneck;
                        sinkEdge.flow += bottleneck;
                        sinkEdge.reverseEdge.flow -= bottleneck;
                        maxFlow += bottleneck;
                    }
                }
            }

            if (sourceToTask.residualCapacity <= 1e-9) break;

            // Try idle window edge: task_i -> widle_k
            const idleEdge = taskEdges.find(e => e.to === `widle_${k}` && e.residualCapacity > 0);
            
            if (idleEdge) {
                const widleEdges = network.getEdges(`widle_${k}`);
                const sinkEdge = widleEdges.find(e => e.to === 'sink' && e.residualCapacity > 0);
                
                if (sinkEdge) {
                    const bottleneck = Math.min(
                        sourceToTask.residualCapacity,
                        idleEdge.residualCapacity,
                        sinkEdge.residualCapacity
                    );

                    if (bottleneck > 1e-9) {
                        sourceToTask.flow += bottleneck;
                        sourceToTask.reverseEdge.flow -= bottleneck;
                        idleEdge.flow += bottleneck;
                        idleEdge.reverseEdge.flow -= bottleneck;
                        sinkEdge.flow += bottleneck;
                        sinkEdge.reverseEdge.flow -= bottleneck;
                        maxFlow += bottleneck;
                    }
                }
            }
        }
    }

    const elapsed = performance.now() - startTime;

    return {
        maxFlow,
        targetFlow,
        feasible: Math.abs(maxFlow - targetFlow) < 1e-6,
        elapsed
    };
}

/**
 * Traditional BFS-based Solver (Edmonds-Karp Algorithm)
 * 
 * This is the baseline solver used in the previous algorithm [12].
 * It uses BFS to find augmenting paths repeatedly.
 * Complexity: O(V * E²) but in practice O(N³) for this flow network structure.
 * 
 * @param {FlowNetwork} network - The flow network (previous structure)
 * @param {object[]} activeJobs - Active jobs
 * @returns {{ maxFlow: number, elapsed: number }}
 */
function bfsSolver(network, activeJobs) {
    const startTime = performance.now();
    
    const targetFlow = activeJobs.reduce((sum, job) => sum + job.remainingExec, 0);
    let maxFlow = 0;

    while (true) {
        // BFS to find augmenting path from source to sink
        const path = bfsFindPath(network, 'source', 'sink');
        
        if (!path) break; // No more augmenting paths

        // Find bottleneck capacity
        let bottleneck = Infinity;
        for (const edge of path) {
            bottleneck = Math.min(bottleneck, edge.residualCapacity);
        }

        if (bottleneck <= 1e-9) break;

        // Update flows along the path
        for (const edge of path) {
            edge.flow += bottleneck;
            edge.reverseEdge.flow -= bottleneck;
        }

        maxFlow += bottleneck;

        // Safety check: don't exceed target
        if (maxFlow >= targetFlow - 1e-6) break;
    }

    const elapsed = performance.now() - startTime;

    return {
        maxFlow,
        targetFlow,
        feasible: Math.abs(maxFlow - targetFlow) < 1e-6,
        elapsed
    };
}

/**
 * BFS to find an augmenting path from source to sink in the residual graph.
 * Returns the edges along the path, or null if no path exists.
 */
function bfsFindPath(network, sourceId, sinkId) {
    const visited = new Set();
    const parent = new Map(); // node -> edge that led to it
    const queue = [sourceId];
    visited.add(sourceId);

    while (queue.length > 0) {
        const current = queue.shift();

        if (current === sinkId) {
            // Reconstruct path
            const path = [];
            let node = sinkId;
            while (node !== sourceId) {
                const edge = parent.get(node);
                path.unshift(edge);
                node = edge.from;
            }
            return path;
        }

        for (const edge of network.getEdges(current)) {
            if (!visited.has(edge.to) && edge.residualCapacity > 1e-9) {
                visited.add(edge.to);
                parent.set(edge.to, edge);
                queue.push(edge.to);
            }
        }
    }

    return null; // No path found
}

module.exports = {
    dseaSolver,
    bfsSolver,
    bfsFindPath
};
