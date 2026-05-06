const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { compareSchedulers } = require('./src/scheduler');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store incoming tasks
let currentTasks = [];
let loadStats = {
    'Load Generator 1': { taskCount: 0, lastActive: null },
    'Load Generator 2': { taskCount: 0, lastActive: null }
};

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('report_load', (data) => {
        const { generator, tasks, timestamp } = data;
        
        // Update stats
        if (loadStats[generator]) {
            loadStats[generator].taskCount += tasks.length;
            loadStats[generator].lastActive = timestamp;
        }

        // Add tasks to pool (keep only recent ones to avoid memory leak)
        currentTasks = [...currentTasks, ...tasks].slice(-50); 

        // Run scheduling comparison on the new task set
        try {
            // Need to map tasks to format expected by scheduler
            const formattedTasks = currentTasks.map(t => ({
                id: t.id,
                releaseTime: t.releaseTime,
                deadline: t.deadline,
                executionTime: t.executionTime,
                utilization: t.utilization
            }));
            
            if (formattedTasks.length > 0) {
                const comparison = compareSchedulers(formattedTasks);
                
                // Broadcast update to all connected dashboard clients
                io.emit('dashboard_update', {
                    loadStats,
                    scheduling: comparison,
                    activeTasks: currentTasks.length,
                    timestamp: Date.now()
                });
            }
        } catch (error) {
            console.error('Scheduling error:', error);
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Analytics server running on port ${PORT}`);
});
