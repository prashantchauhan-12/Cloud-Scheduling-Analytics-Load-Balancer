/**
 * Flow Network Construction for Real-Time Scheduling
 * Based on: Section IV-A of Sun & Cho (IEEE Access 2022)
 * 
 * Implements:
 *   - Flow network for real-time tasks (Figure 1a)
 *   - Flow network for idle time (Figure 1c)
 *   - Combined flow network (Figure 1e)
 *   - Edge capacity computation (Equations 5-11)
 */

const { getActiveJobIndices } = require('./taskModel');

/**
 * Node types in the flow network
 */
const NodeType = {
    SOURCE: 'source',
    SINK: 'sink',
    TASK: 'task',
    WINDOW_RT: 'window_rt',   // Window for real-time tasks
    WINDOW_IDLE: 'window_idle' // Window for idle time
};

/**
 * Represents an edge in the flow network
 */
class Edge {
    constructor(from, to, capacity) {
        this.from = from;
        this.to = to;
        this.capacity = capacity;
        this.flow = 0;
        this.reverseEdge = null; // Reference to reverse edge for residual graph
    }

    get residualCapacity() {
        return this.capacity - this.flow;
    }
}

/**
 * Flow Network Graph
 * Directed, capacitated graph G = (V, E)
 */
class FlowNetwork {
    constructor() {
        this.nodes = new Map();      // node_id -> { type, data }
        this.adjacency = new Map();  // node_id -> Edge[]
        this.edgeCount = 0;
    }

    addNode(id, type, data = {}) {
        this.nodes.set(id, { type, data });
        if (!this.adjacency.has(id)) {
            this.adjacency.set(id, []);
        }
    }

    addEdge(fromId, toId, capacity) {
        // Forward edge
        const forward = new Edge(fromId, toId, capacity);
        // Reverse edge (for residual graph)
        const reverse = new Edge(toId, fromId, 0);
        
        forward.reverseEdge = reverse;
        reverse.reverseEdge = forward;

        this.adjacency.get(fromId).push(forward);
        this.adjacency.get(toId).push(reverse);
        this.edgeCount += 2;

        return forward;
    }

    getEdges(nodeId) {
        return this.adjacency.get(nodeId) || [];
    }

    getNodeIds() {
        return Array.from(this.nodes.keys());
    }

    /**
     * Reset all flows to 0
     */
    resetFlows() {
        for (const [, edges] of this.adjacency) {
            for (const edge of edges) {
                edge.flow = 0;
            }
        }
    }

    /**
     * Deep clone the network (for running different solvers on the same graph)
     */
    clone() {
        const newNet = new FlowNetwork();
        
        // Clone nodes
        for (const [id, info] of this.nodes) {
            newNet.addNode(id, info.type, { ...info.data });
        }

        // Clone edges (need to rebuild edge references)
        const edgeMap = new Map(); // track forward edges
        for (const [nodeId, edges] of this.adjacency) {
            for (const edge of edges) {
                if (edge.capacity > 0 || edge.flow > 0) {
                    // Only clone forward edges (reverse edges created automatically)
                    if (edge.capacity > 0) {
                        const key = `${edge.from}->${edge.to}`;
                        if (!edgeMap.has(key)) {
                            newNet.addEdge(edge.from, edge.to, edge.capacity);
                            edgeMap.set(key, true);
                        }
                    }
                }
            }
        }

        return newNet;
    }
}

/**
 * Construct the combined flow network for real-time tasks and idle time
 * as described in Section IV-A (Figure 1(e)).
 * 
 * The network has:
 *   - Source node n_s
 *   - Sink node n_t
 *   - Task nodes τ_i for each active job
 *   - Window nodes W_k for RT task flow
 *   - Window nodes I_k for idle time flow
 * 
 * @param {object[]} activeJobs - Active jobs at current time
 * @param {object[]} windows - Time windows [{index, start, end, length}]
 * @param {number} totalUtil - Total utilization U
 * @returns {FlowNetwork} The constructed combined flow network
 */
function constructCombinedFlowNetwork(activeJobs, windows, totalUtil) {
    const network = new FlowNetwork();
    const N = activeJobs.length;
    const K = windows.length;

    // Source and sink
    network.addNode('source', NodeType.SOURCE);
    network.addNode('sink', NodeType.SINK);

    // Task nodes
    for (let i = 0; i < N; i++) {
        network.addNode(`task_${i}`, NodeType.TASK, { jobIndex: i, job: activeJobs[i] });
    }

    // Window nodes for RT tasks and idle time
    for (let k = 0; k < K; k++) {
        network.addNode(`wrt_${k}`, NodeType.WINDOW_RT, { windowIndex: k, window: windows[k] });
        network.addNode(`widle_${k}`, NodeType.WINDOW_IDLE, { windowIndex: k, window: windows[k] });
    }

    // U_idle: utilization available for idle time
    const M = Math.ceil(totalUtil); // Number of processors
    const U_idle = M - totalUtil;   // Remaining capacity for idle time

    // --- Source to Task edges ---
    // cap(n_s -> τ_i) = c_i(t) = remaining execution time
    for (let i = 0; i < N; i++) {
        const cap = activeJobs[i].remainingExec;
        network.addEdge('source', `task_${i}`, cap);
    }

    // --- Task to RT Window edges ---
    // cap(τ_i -> W_k) = l_k × u_i  (Equation 10: NIP constraint)
    // Only if task is active in window
    for (let i = 0; i < N; i++) {
        for (let k = 0; k < K; k++) {
            const win = windows[k];
            const job = activeJobs[i];
            
            // Check if task is active in this window: W_k ⊂ [a_i(t), d_i(t)]
            if (win.start >= job.arrivalTime && win.end <= job.absoluteDeadline) {
                const cap = win.length * job.utilization;
                if (cap > 0) {
                    network.addEdge(`task_${i}`, `wrt_${k}`, cap);
                }
            }
        }
    }

    // --- Task to Idle Window edges ---
    // cap(τ_i -> I_k) = min(l_k × U_idle, l_k - l_k × u_i)  (Equation 11)
    for (let i = 0; i < N; i++) {
        for (let k = 0; k < K; k++) {
            const win = windows[k];
            const job = activeJobs[i];

            if (win.start >= job.arrivalTime && win.end <= job.absoluteDeadline) {
                const cap = Math.min(
                    win.length * U_idle,
                    win.length - win.length * job.utilization
                );
                if (cap > 1e-9) {
                    network.addEdge(`task_${i}`, `widle_${k}`, cap);
                }
            }
        }
    }

    // --- RT Window to Sink edges ---
    // cap(W_k -> n_t) = (Σ C_i/T_i for active jobs in W_k) × l_k  (Equation 8: PCC)
    for (let k = 0; k < K; k++) {
        const win = windows[k];
        const jobIndices = getActiveJobIndices(activeJobs, win);
        const sumUtil = jobIndices.reduce((s, i) => s + activeJobs[i].utilization, 0);
        const cap = sumUtil * win.length;
        if (cap > 0) {
            network.addEdge(`wrt_${k}`, 'sink', cap);
        }
    }

    // --- Idle Window to Sink edges ---
    // cap(I_k -> n_t) = l_k × U_idle  (Equation 9)
    for (let k = 0; k < K; k++) {
        const cap = windows[k].length * U_idle;
        if (cap > 1e-9) {
            network.addEdge(`widle_${k}`, 'sink', cap);
        }
    }

    return network;
}

/**
 * Construct a simpler flow network (previous algorithm from Appendix A)
 * This is the baseline with higher complexity O(N³ log N)
 * 
 * @param {object[]} activeJobs - Active jobs at current time
 * @param {object[]} windows - Time windows
 * @param {number} totalUtil - Total utilization
 * @returns {FlowNetwork} The flow network for the previous algorithm
 */
function constructPreviousFlowNetwork(activeJobs, windows, totalUtil) {
    const network = new FlowNetwork();
    const N = activeJobs.length;
    const K = windows.length;
    const M = Math.ceil(totalUtil);

    // Source and sink
    network.addNode('source', NodeType.SOURCE);
    network.addNode('sink', NodeType.SINK);

    // Task nodes
    for (let i = 0; i < N; i++) {
        network.addNode(`task_${i}`, NodeType.TASK, { jobIndex: i, job: activeJobs[i] });
    }

    // Window nodes (single set, no separate idle windows)
    for (let k = 0; k < K; k++) {
        network.addNode(`w_${k}`, NodeType.WINDOW_RT, { windowIndex: k, window: windows[k] });
    }

    // Source to Task edges: cap = c_i(t)
    for (let i = 0; i < N; i++) {
        network.addEdge('source', `task_${i}`, activeJobs[i].remainingExec);
    }

    // Task to Window edges: cap = l_k (full window length, Equation 19)
    for (let i = 0; i < N; i++) {
        for (let k = 0; k < K; k++) {
            const win = windows[k];
            const job = activeJobs[i];
            if (win.start >= job.arrivalTime && win.end <= job.absoluteDeadline) {
                network.addEdge(`task_${i}`, `w_${k}`, win.length);
            }
        }
    }

    // Window to Sink edges: Cap(W_k) = (M - Σ u_i for inactive) × l_k  (Equation 22)
    for (let k = 0; k < K; k++) {
        const win = windows[k];
        const jobIndices = getActiveJobIndices(activeJobs, win);
        // All tasks not active in this window
        let inactiveUtil = 0;
        for (let i = 0; i < N; i++) {
            if (!jobIndices.includes(i)) {
                inactiveUtil += activeJobs[i].utilization;
            }
        }
        const cap = (M - inactiveUtil) * win.length;
        if (cap > 0) {
            network.addEdge(`w_${k}`, 'sink', cap);
        }
    }

    return network;
}

module.exports = {
    NodeType,
    Edge,
    FlowNetwork,
    constructCombinedFlowNetwork,
    constructPreviousFlowNetwork
};
