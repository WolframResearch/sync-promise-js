import process from 'process';

// TODO: Use proper logger.
const logger = console;

// import * as loggers from 'loggers';
//
// const logger = loggers.create('main');

const DEBUG = process.env.NODE_ENV !== 'production';

const PENDING = 0;
const FULFILLED = 1;
const REJECTED = 2;
type Thenable<T> = SyncPromise<T> | Promise<T> | PromiseLike<T> | T; // {then<R>: (callback?: (value: T) => R) => Thenable<T>} | T;

type Executor<T> = (resolve: (value?: Thenable<T>) => void, reject: (exception?: any) => void) => void;
type Callback<T, R> = (value: T) => Thenable<R> | null | undefined;
type Handler = (value: any) => void;
type StartCallback = (cancel: () => void) => void;

// To save memory, we combine the handler count, promise state, stack depth and the handled flag
// into one single (31-bit) bitfield (which just fits into a 32-bit number, which is what
// bitwise operations work with in JS). Below are the bit offsets of the parts of the bitfield,
// starting with the least significant.
const TOTAL_BITS = 32;
const OFFSET_HANDLER_COUNT = 0;
const BITS_HANDLER_COUNT = 18;
const OFFSET_STATE = BITS_HANDLER_COUNT;
const BITS_STATE = 2;
const OFFSET_STACK_DEPTH = OFFSET_STATE + BITS_STATE;
const BITS_STACK_DEPTH = 10;
const OFFSET_IS_HANDLED = OFFSET_STACK_DEPTH + BITS_STACK_DEPTH;

const MAX_HANDLER_COUNT = 1 << (BITS_HANDLER_COUNT - 1);
const MASK_HANDLER_COUNT = (~0 >>> (TOTAL_BITS - BITS_HANDLER_COUNT)) << OFFSET_HANDLER_COUNT;
const MASK_STATE = (~0 >>> (TOTAL_BITS - BITS_STATE)) << OFFSET_STATE;
const MASK_STACK_DEPTH = (~0 >>> (TOTAL_BITS - BITS_STACK_DEPTH)) << OFFSET_STACK_DEPTH;
const FLAG_HANDLED = 1 << OFFSET_IS_HANDLED;

/**
 * Sets the promise state in the flags bitfield.
 * @param flags Bitfield for the various SyncPromise flags.
 * @param state New state value.
 * @returns The new flags bitfield.
 */
function setStateFlags(flags: number, state: number): number {
    return (flags & ~MASK_STATE) | (state << OFFSET_STATE);
}

/**
 * The maximum stack depth until which to proceed synchronously.
 * Once this limit is reached, the SyncPromise will introduce an asynchronous step.
 * This is to avoid reaching the browser's maximum recursion depth.
 * Note that this must be smaller than `1 << (STACK_DEPTH_BIT_END - STACK_DEPTH_BIT_START)`.
 */
const MAX_STACK_DEPTH = 1000;

/**
 * Data layout for storing fulfill and reject handlers in SyncPromise.
 * Store the first handler as a property (having a single handler is the most common use case, so we optimize for that).
 * Store all other handlers as indexed properties on the SyncPromise itself (avoiding allocation of any other Arrays).
 * Inspired by https://github.com/cscott/babybird
 */
type HandlerStore = {
    flags: number;
    fulfillHandler0: Handler | null | undefined;
    rejectHandler0: Handler | null | undefined;
} & (Handler | null | undefined)[];

function addHandlers(
    promise: HandlerStore,
    fulfillHandler: Handler | null | undefined,
    rejectHandler: Handler | null | undefined
) {
    const c = (promise.flags & MASK_HANDLER_COUNT) >>> OFFSET_HANDLER_COUNT;
    if (c >= MAX_HANDLER_COUNT) {
        throw new Error('Too many handlers on SyncPromise');
    }
    if (c) {
        // If there is 1 handler already, we need to write to slots 0 and 1;
        // If there is 2, we write to slots 2 and 3, etc.
        const i = c - 1;
        promise[2 * i] = fulfillHandler;
        promise[2 * i + 1] = rejectHandler;
    } else {
        // If there is no handler yet, use the shortcut properties.
        promise.fulfillHandler0 = fulfillHandler;
        promise.rejectHandler0 = rejectHandler;
    }
    ++promise.flags;
}

function executeHandlers(promise: HandlerStore, offset: 0 | 1, arg: any): boolean {
    const c = (promise.flags & MASK_HANDLER_COUNT) >>> OFFSET_HANDLER_COUNT;
    if (c >= 1) {
        const handler0 = offset ? promise.rejectHandler0 : promise.fulfillHandler0;
        if (handler0) {
            handler0(arg);
        }
        // Reset the handler count to 0.
        promise.flags &= ~MASK_HANDLER_COUNT;
        promise.fulfillHandler0 = null;
        promise.rejectHandler0 = null;
        for (let i = 0; i < c - 1; ++i) {
            const handler = promise[2 * i + offset];
            if (handler) {
                handler(arg);
            }
            // Don't even bother shrinking the array (which would only need more time), just write `null`s to it.
            promise[2 * i] = null;
            promise[2 * i + 1] = null;
        }
        return true;
    }
    return false;
}

function createHandler(
    callback: Callback<any, any> | null | undefined,
    resolve,
    reject,
    async = false,
    isReject = false
): Handler {
    function handler(value) {
        let successful = false;
        let result = value;
        try {
            if (callback) {
                result = callback(value);
                successful = true;
            } else if (isReject) {
                // If this is the rejection handler being called (i.e. the original promise was rejected)
                // and the .then call didn't specify an explicit onRejected callback,
                // then reject the resulting promise immediately.
                // In that case, don't set `successful = true`, otherwise we would try to settle the promise again
                // after rejecting it here.
                reject(value);
            } else {
                // If there is no callback and this is not a rejection handler, resolve the promise with the
                // original value.
                successful = true;
            }
        } catch (error) {
            successful = false;
            reject(error);
        }
        if (successful) {
            const then = result && result.then;
            if (then && typeof then === 'function') {
                then.call(result, resolve, reject);
            } else {
                resolve(result);
            }
        }
    }

    if (async) {
        return value => {
            setTimeout(() => {
                handler(value);
            }, 0);
        };
    } else {
        return handler;
    }
}

function execute<T>(executor: Executor<T>, fulfill: (value?: Thenable<T>) => void, reject: (exception: any) => void) {
    try {
        executor(fulfill, reject);
    } catch (exception) {
        reject(exception);
    }
}

function monitorCatch(promise: SyncPromise<any>) {
    setTimeout(() => {
        const isHandled = promise.flags & FLAG_HANDLED;
        if (!isHandled) {
            const exception = promise.result;
            logger.error('Exception in SyncPromise without .catch', exception);
            throw exception;
        }
    }, 0);
}

/**
 * A synchronous Promise implementation.
 * Follows the spec https://promisesaplus.com/ except for https://promisesaplus.com/#point-34 .
 * An alternative would have been https://github.com/paldepind/sync-promise but it doesn't allow chaining.
 */
class SyncPromise<T> implements PromiseLike<T> {
    /**
     * The flags property contains the handler count, the current stack depth, the promise state, and the is-handled flag
     * in one single bitfield.
     */
    flags: number;

    result: any;
    fulfillHandler0: Handler | null | undefined;
    rejectHandler0: Handler | null | undefined;
    _fulfilledNonPending: boolean;
    _rejectedNonPending: boolean;

    static resolve<R>(
        value?:
            | SyncPromise<R>
            | Promise<R>
            | {
            then: () => R;
        }
            | R,
        depth?: number
    ): SyncPromise<R> {
        const then: Executor<R> | null | undefined = value && ((value as any).then as any);

        if (typeof then === 'function') {
            return new SyncPromise((resolve, reject) => {
                then.call(value, resolve, reject);
            }, depth);
        } else {
            const promise = new SyncPromise(null, depth);
            promise.flags = setStateFlags(promise.flags, FULFILLED);
            promise.result = value;
            return promise as any;
        }
    }

    static reject(exception?: any, depth?: number): SyncPromise<any> {
        const promise = new SyncPromise(null, depth);
        promise.flags = setStateFlags(promise.flags, REJECTED);
        promise.result = exception;
        if (DEBUG) {
            monitorCatch(promise);
        }
        return promise;
    }

    static method<R>(func: () => any, depth?: number): SyncPromise<R> {
        try {
            return SyncPromise.resolve(func(), depth);
        } catch (error) {
            return SyncPromise.reject(error, depth) as any;
        }
    }

    static all(futures: Iterable<any> | Array<any>): SyncPromise<any> {
        const futuresArray: Array<any> = Array.isArray(futures) ? futures : Array.from(futures);
        if (!futuresArray.length) {
            return SyncPromise.resolve([]);
        }
        return new SyncPromise((resolve, reject) => {
            let resolvedCount = 0;
            const values: any[] = [];
            let done = false;

            function resolver(i, l) {
                return value => {
                    if (!done) {
                        values[i] = value;
                        ++resolvedCount;
                        if (resolvedCount === l) {
                            done = true;
                            resolve(values);
                        }
                    }
                };
            }

            function rejecter() {
                return error => {
                    if (!done) {
                        reject(error);
                        done = true;
                    }
                };
            }

            for (let i = 0, l = futuresArray.length; i < l; ++i) {
                const future = futuresArray[i];
                const then = future && future.then;
                if (then && typeof then === 'function') {
                    then.call(future, resolver(i, l), rejecter());
                } else {
                    // If an item is not a Promise, treat it like it's resolved immediately.
                    resolver(i, l)(future);
                }
            }
        });
    }

    /**
     * Returns a promise that settles as soon as one of the given promise is settled,
     * either resolving or rejecting with the same value or error as that promise.
     * @param futures Array of Promises, SyncPromises, or other values.
     * @returns A SyncPromise. If one of the given values is not a promise, it is assumed
     * to already be resolved, so the result will resolve synchronously to that value.
     * If the list of futures is empty, a never-resolving promise is returned.
     */
    static race(futures: Iterable<any> | Array<any>): SyncPromise<any> {
        const futuresArray: Array<any> = Array.isArray(futures) ? futures : Array.from(futures);
        if (!futuresArray.length) {
            return new SyncPromise();
        }
        return new SyncPromise((resolve, reject) => {
            let done = false;

            function resolver(value) {
                if (!done) {
                    resolve(value);
                    done = true;
                }
            }

            function rejecter(error) {
                if (!done) {
                    reject(error);
                    done = true;
                }
            }

            for (let i = 0, l = futuresArray.length; i < l; ++i) {
                const future = futuresArray[i];
                const then = future && future.then;
                if (then && typeof then === 'function') {
                    then.call(future, resolver, rejecter);
                } else {
                    // If an item is not a Promise, treat it like it's resolved immediately.
                    resolver(future);
                }
            }
        });
    }

    /**
     * Applies a reducer to an array of values, receiving and returning an accumulated value.
     * @param futures Array of values. Might contain promises, which are waited for before applying the reducer.
     * @param reducer Reducer function receiving the current accumulator and the current value.
     * Might return a promise which is waited for before moving on to the next value.
     * @param initialValue Initial value of the accumulator, i.e. the value passed to the first invocation of the reducer.
     * @returns Promise resolving to the final accumulator value returned by the last invocation of the reducer
     * (or the `initialValue` if `futures` is empty).
     */
    static reduce<Value, Acc>(
        futures: Array<Value | Promise<Value> | SyncPromise<Value>>,
        reducer: (accumulator: Acc, item: Value, index: number, length: number) => Acc | SyncPromise<Acc>,
        initialValue: Acc
    ): SyncPromise<Acc> {
        const length = futures.length;
        return futures.reduce((accPromise, valuePromise, currentIndex) => {
            return accPromise.then(acc => {
                return SyncPromise.resolve(valuePromise).then((value: Value) => {
                    return reducer(acc, value, currentIndex, length);
                });
            });
        }, SyncPromise.resolve(initialValue));
    }

    /**
     * Applies a function to each value of an array, waiting for promises to resolve at each step.
     * Similar to `SyncPromise.reduce`, but does not maintain an accumulated value.
     * @param futures Array of values. Might contain promises, which are waited for before applying the iterator.
     * @param iterator Function applied to all (resolved) values of the array.
     * Might return a promise which is waited for before moving on to the next value.
     * @returns Promise resolving when all values have been iterated over.
     */
    static waterfall<Value, Result>(
        futures: ReadonlyArray<Value | Promise<Value> | SyncPromise<Value>>,
        iterator: (item: Value, index: number, length: number) => SyncPromise<Result> | Result
    ): SyncPromise<Result | void> {
        const length = futures.length;
        return futures.reduce((accPromise, valuePromise, currentIndex) => {
            return (accPromise as any).then(acc => {
                return SyncPromise.resolve(valuePromise).then(value => {
                    return iterator(value, currentIndex, length);
                });
            });
        }, SyncPromise.resolve()) as any;
    }

    static delay(ms?: number) {
        return new SyncPromise(resolve => {
            setTimeout(resolve, ms || 0);
        });
    }

    static defer() {
        return SyncPromise.delay(0);
    }

    constructor(executor?: Executor<T> | null | undefined, depth?: number) {
        this.flags = (depth || 0) << OFFSET_STACK_DEPTH;
        this.result = null;
        this.fulfillHandler0 = null;
        this.rejectHandler0 = null;
        if (executor) {
            execute(executor, this.dangerouslyResolve.bind(this), this.dangerouslyReject.bind(this));
        }
    }

    then<R>(
        onFulfilled: Callback<T, R> | null | undefined,
        onRejected?: Callback<any, any> | null | undefined
    ): SyncPromise<any> {
        const flags = this.flags;
        const stackDepth = (flags & MASK_STACK_DEPTH) >>> OFFSET_STACK_DEPTH;
        const async = stackDepth >= MAX_STACK_DEPTH;
        const state = (flags & MASK_STATE) >>> OFFSET_STATE;
        switch (state) {
            case FULFILLED:
                if (onFulfilled) {
                    this.flags |= FLAG_HANDLED;
                    if (async) {
                        return SyncPromise.defer().then(() => onFulfilled && onFulfilled(this.result));
                    }
                    return SyncPromise.method(() => onFulfilled && onFulfilled(this.result), stackDepth + 1);
                } else {
                    return this;
                }
            case REJECTED:
                if (onRejected) {
                    this.flags |= FLAG_HANDLED;
                    if (async) {
                        return SyncPromise.defer().then(() => onRejected && onRejected(this.result));
                    }
                    return SyncPromise.method(() => onRejected && onRejected(this.result), stackDepth + 1);
                } else {
                    return this;
                }
            default:
                this.flags |= FLAG_HANDLED;
                return new SyncPromise(
                    (resolve, reject) => {
                        const fulfillHandler = createHandler(onFulfilled, resolve, reject, async);
                        const rejectHandler = createHandler(onRejected, resolve, reject, async, true);
                        addHandlers(this as any, fulfillHandler, rejectHandler);
                    },
                    async ? 0 : stackDepth + 1
                );
        }
    }

    catch<E>(errorHandler: Callback<any, E> | null | undefined): SyncPromise<any> {
        return this.then(null, errorHandler);
    }

    finally(handler: Callback<any, any>): SyncPromise<any> {
        return this.then(
            value => {
                handler(undefined);
                return value;
            },
            error => {
                handler(undefined);
                throw error;
            }
        );
    }

    isPending() {
        const state = (this.flags & MASK_STATE) >>> OFFSET_STATE;
        return state === PENDING;
    }

    isSettled() {
        const state = (this.flags & MASK_STATE) >>> OFFSET_STATE;
        return state !== PENDING;
    }

    isFulfilled() {
        const state = (this.flags & MASK_STATE) >>> OFFSET_STATE;
        return state === FULFILLED;
    }

    isRejected() {
        const state = (this.flags & MASK_STATE) >>> OFFSET_STATE;
        return state === REJECTED;
    }

    async() {
        return SyncPromise.resolve(this, MAX_STACK_DEPTH);
    }

    getValueSync(): T | null | undefined {
        if (this.isFulfilled()) {
            return this.result;
        }
        return undefined;
    }

    getExceptionSync() {
        if (this.isRejected()) {
            // When an exception is queried synchronously, consider it "handled".
            // This avoids a bunch of "Exception in SyncPromise without a .catch" errors
            // due to how _doPrepare in Component.js works.
            this.flags |= FLAG_HANDLED;
            return this.result;
        }
        return undefined;
    }

    thenSync<R>(onSyncFulfilled: Callback<T, R>): SyncPromise<T> | SyncPromise<R> {
        if (this.isSettled()) {
            return this.then(onSyncFulfilled);
        }
        return this;
    }

    thenAsync<R>(onAsyncFulfilled: Callback<T, R>, onAsyncStart?: StartCallback): SyncPromise<T> | SyncPromise<R> {
        if (this.isPending()) {
            let cancelled = false;
            if (onAsyncStart) {
                try {
                    onAsyncStart(() => {
                        cancelled = true;
                    });
                } catch (error) {
                    return SyncPromise.reject(error) as any;
                }
            }

            return this.then(result => {
                if (cancelled) {
                    return undefined;
                }
                return onAsyncFulfilled(result);
            });
        }
        return this;
    }

    catchSync<E>(onSyncError: Callback<any, E>): SyncPromise<T> | SyncPromise<E> {
        if (this.isSettled()) {
            return this.catch(onSyncError);
        }
        return this;
    }

    catchAsync<E>(onAsyncError: Callback<any, E>): SyncPromise<T> | SyncPromise<E> {
        if (this.isPending()) {
            return this.catch(onAsyncError);
        }
        return this;
    }

    /**
     * Directly resolves this SyncPromise instance.
     * This is not part of the official Promise API and should only be used if absolutely necessary.
     * Usually, a promise should be resolved from within the executor passed to the constructor.
     * @param value Value to resolve the promise to.
     */
    dangerouslyResolve(value?: Thenable<T>): void {
        const flags = this.flags;
        const state = (this.flags & MASK_STATE) >>> OFFSET_STATE;
        if (state === PENDING) {
            const then: Executor<T> | null | undefined = value && ((value as any).then as any);

            if (then && typeof then === 'function') {
                then.call(value, this.dangerouslyResolve.bind(this), this.dangerouslyReject.bind(this));
            } else {
                this.result = value;
                this.flags = setStateFlags(flags, FULFILLED);
                executeHandlers(this as any, 0, value);
            }
        } else {
            logger.warn('Fulfilling non-pending SyncPromise', this);
            // Set a flag for testing purposes.
            this._fulfilledNonPending = true;
        }
    }

    /**
     * Directly rejects this SyncPromise instance.
     * This is not part of the official Promise API and should only be used if absolutely necessary.
     * Usually, a promise should be rejected from within the executor passed to the constructor.
     * @param exception Error to reject the promise with.
     */
    dangerouslyReject(exception: any): void {
        const flags = this.flags;
        const state = (flags & MASK_STATE) >>> OFFSET_STATE;
        if (state === PENDING) {
            this.result = exception;
            this.flags = setStateFlags(flags, REJECTED);
            const hadHandlers = executeHandlers(this as any, 1, exception);

            if (DEBUG && !hadHandlers) {
                // If the SyncPromise is rejected and there are no reject handlers,
                // wait for another tick to see if the rejection is handled afterwards,
                // as in `SyncPromise.reject().catch()`.
                // If it's still not handled, then throw an error.
                // Only do this in DEBUG mode, since it has a significant performance impact.
                monitorCatch(this);
            }
        } else {
            logger.warn('Rejecting non-pending SyncPromise', this);
            // Set a flag for testing purposes.
            this._rejectedNonPending = true;
        }
    }
}

export default SyncPromise;
