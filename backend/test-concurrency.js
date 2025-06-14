const SimpleQueue = require('./src/utils/simple-queue');

async function testConcurrency() {
    console.log('Testing SimpleQueue concurrency...');
    
    const queue = new SimpleQueue({ concurrency: 5 });
    const startTime = Date.now();
    
    // Criar 10 tarefas que demoram 1 segundo cada
    const tasks = [];
    for (let i = 1; i <= 10; i++) {
        tasks.push(
            queue.add(async () => {
                console.log(`[${new Date().toISOString()}] Task ${i} started`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                console.log(`[${new Date().toISOString()}] Task ${i} completed`);
                return i;
            })
        );
    }
    
    // Aguardar todas as tarefas
    await Promise.all(tasks);
    
    const duration = (Date.now() - startTime) / 1000;
    console.log(`\nAll tasks completed in ${duration.toFixed(2)} seconds`);
    console.log('Expected: ~2 seconds (10 tasks / 5 concurrency)');
}

testConcurrency();
