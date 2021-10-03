# SyncPromise API

## Constructor

### new SyncPromise(executor)

Constructs a new promise based on the given executor function.

The executor receives two arguments, `resolve` and `reject`. One of them should eventually be called (synchronously or asynchronously) to settle the promise.

#### Example

    new SyncPromise((resolve, reject) => {
        if (2 > 1) {
            resolve('correct');
        } else {
            reject(new Error('incorrect'));
        }
    });

## Static methods

### SyncPromise.resolve(result)

Constructs a new (resolved) promise based on the given ("static") result.

#### Example

    SyncPromise.resolve(42).then(result => {
        console.log(result);
        // will print 42 (synchronously)
    });

### SyncPromise.reject(exception)

Constructs a new (rejected) promise based on the given exception. 

#### Example

    SyncPromise.reject(new Error('error')).catch(exc => {
        console.error(exc);
    });

### SyncPromise.method(func)

Constructs a new promise based on the given callback function.

If the function throws an exception (whether that happens synchronously or asynchronously), the returned promise is rejected.

### SyncPromise.all(array)

Returns a promise that resolves when all the promises in the given array are resolved.

If any of the given promises is rejected, the returned promise is rejected with the same exception.

Non-promise array values are treated like resolved promises.

### SyncPromise.race(array)

Returns a promise the is settled as soon as the first promise in the given array is settled.

The returned promise can be either fulfilled or rejected, depending on the outcome of the first settled promise.

Non-promise array values are treated like resolved promises.

### SyncPromise.reduce(array, reducer, initialValue)

Applies a reducer to an array of promises, receiving and returning an accumulated value.

Promises are waited to resolve before applying the reducer. The reducer might return a promise, which is also waited for before continuing.

Non-promise array values are treated like resolved promises.

### SyncPromise.waterfall(array, func)

Applies a function to each value of an array, waiting for promises to resolve at each step.

This is similar to `SyncPromise.reduce`, but does not maintain an accumulated value.

### SyncPromise.delay(ms)

Returns a promise that waits for a given number of milliseconds and then resolves to `undefined`. 

### SyncPromise.defer()

Returns a promise that asynchronously resolves to `undefined`. 

## Instance methods

### SyncPromise#then(onFulfilled, onRejected)

Executes either `onFulfilled` or `onRejected` when this promise is fulfilled or rejected, respectively.

This method is "chainable": It returns another promise that resolves depending on the return value of the called handler function (which can also be another promise).

### SyncPromise#catch(onRejected)

Executes the callback function if/when this promise is rejected.

Like `SyncPromise#then`, this method is chainable.

### SyncPromise#finally(func)

Executes the given function when this promise is settled (fulfilled or rejected), and then resolves with the original result or error.

### SyncPromise#isPending()

Returns whether the promise is currently pending, i.e. it has not been fulfilled or rejected yet.

### SyncPromise#isSettled()

Returns whether this promise is already settled, i.e. it has been fulfilled or rejected.

### SyncPromise#isFulfilled()

Returns whether this promise is fulfilled.

### SyncPromise#isRejected()

Returns whether this promise has been rejected.

### SyncPromise#async

Returns a promise with the same resolution (fulfilled or rejected) as this promise, but is guaranteed to resolve asynchronously.

### SyncPromise#getValueSync

Synchronously retrieves the fulfilled value of this promise, or `undefined` if this promise has not been fulfilled (yet).

### SyncPromise#getExceptionSync

Synchronously retrieves the rejection value (exception) of this promise, or `undefined` if this promise has not been rejected (yet).
