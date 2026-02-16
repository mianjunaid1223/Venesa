const logger = require('./logger');

class TaskRegistry {
    constructor() {
        this.tasks = new Map();
    }

    register(name, handler, meta = {}) {
        if (typeof handler !== 'function') {
            throw new Error(`Handler for "${name}" must be a function`);
        }
        this.tasks.set(name, {
            handler,
            description: meta.description || '',
            params: meta.params || [],
            tags: meta.tags || [],
            marker: meta.marker || 'announce',
            safe: meta.safe !== false,
        });
    }

    get(name) {
        return this.tasks.get(name) || null;
    }

    has(name) {
        return this.tasks.has(name);
    }

    async execute(name, params = {}) {
        const task = this.tasks.get(name);
        if (!task) {
            return { error: `Unknown task: ${name}` };
        }
        try {
            const result = await task.handler(params);
            return { success: true, result };
        } catch (e) {
            logger.error(`Task "${name}" failed: ${e.message}`);
            return { error: e.message };
        }
    }

    list() {
        const out = [];
        for (const [name, meta] of this.tasks) {
            out.push({
                name,
                description: meta.description,
                params: meta.params,
                tags: meta.tags,
                marker: meta.marker,
            });
        }
        return out;
    }

    findByTag(tag) {
        return this.list().filter(t => t.tags.includes(tag));
    }
}

module.exports = new TaskRegistry();
