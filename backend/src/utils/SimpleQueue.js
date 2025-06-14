// Simple Queue implementation with concurrency control
class SimpleQueue {
    constructor({ concurrency = 1 } = {}) {
        this.concurrency = concurrency;
        this.running = 0;
        this.queue = [];
    }

    async add(task) {
        return new Promise((resolve, reject) => {
            this.queue.push({
                task,
                resolve,
                reject
            });
            this.process();
        });
    }

    async process() {
        if (this.running >= this.concurrency || this.queue.length === 0) {
            return;
        }

        this.running++;
        const { task, resolve, reject } = this.queue.shift();

        try {
            const result = await task();
            resolve(result);
        } catch (error) {
            reject(error);
        } finally {
            this.running--;
            this.process();
        }
    }

    async drain() {
        return new Promise((resolve) => {
            const checkDone = () => {
                if (this.running === 0 && this.queue.length === 0) {
                    resolve();
                } else {
                    setTimeout(checkDone, 100);
                }
            };
            checkDone();
        });
    }
}

module.exports = SimpleQueue;
