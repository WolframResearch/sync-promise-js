import SyncPromise from '../src/SyncPromise';

describe('SyncPromise', () => {
    function setTimeout(func, delay) {
        SyncPromise.defer().then(func);
        return 1;
    }

    it('resolves synchronously when possible (1)', done => {
        const f = new SyncPromise(resolve => {
            resolve(42);
        });
        const handler = jest.fn();
        f.then(handler);
        expect(handler).toHaveBeenCalledWith(42);
        f.then(value => {
            expect(value).toBe(42);
            done();
        });
    });
    it('resolves synchronously when possible (2)', done => {
        let sameExecutionFrame = true;
        SyncPromise.resolve(1).then(() => {
            expect(sameExecutionFrame).toBe(true);
            done();
        });
        sameExecutionFrame = false;
    });
    it('does not settle a non-pending promise in the case of an uncaught rejection', () => {
        const promise = SyncPromise.reject(1).then(() => {});
        expect(promise._fulfilledNonPending).not.toBeDefined();
        expect(promise._rejectedNonPending).not.toBeDefined();
        // Catch the error eventually to avoid the exception being re-thrown.
        promise.catch(() => {});
    });
    describe('.async', () => {
        it('forces asynchronous resolution', done => {
            let sameContext = true;
            SyncPromise.resolve(1)
                .async()
                .then(() => {
                    expect(sameContext).toBe(false);
                    done();
                });
            sameContext = false;
        });
    });
    it('supports synchronous inspection of its state', () => {
        const fulfilled = SyncPromise.resolve(1);
        expect(fulfilled.isSettled()).toBe(true);
        expect(fulfilled.isPending()).toBe(false);
        expect(fulfilled.isFulfilled()).toBe(true);
        expect(fulfilled.isRejected()).toBe(false);
        const rejected = SyncPromise.reject(1);
        expect(rejected.isSettled()).toBe(true);
        expect(rejected.isPending()).toBe(false);
        expect(rejected.isFulfilled()).toBe(false);
        expect(rejected.isRejected()).toBe(true);
        rejected.catch(() => {}); // ignore the error
    });
    it('can resolve asynchronously', done => {
        const f = new SyncPromise(resolve => {
            setTimeout(() => {
                resolve(42);
            }, 10);
        });
        f.then(value => {
            expect(value).toBe(42);
            done();
        });
    });
    describe('.resolve', () => {
        it('resolves a plain value to the value', done => {
            SyncPromise.resolve(1).then(value => {
                expect(value).toBe(1);
                done();
            });
        });
        it('resolves another SyncPromise to its value', done => {
            SyncPromise.resolve(SyncPromise.resolve(2)).then(value => {
                expect(value).toBe(2);
                done();
            });
        });
        it('rejects if a given SyncPromise rejects synchronously', done => {
            SyncPromise.resolve(SyncPromise.reject('error')).catch(error => {
                expect(error).toEqual('error');
                done();
            });
        });
        it('rejects if a given SyncPromise rejects asynchronously', done => {
            SyncPromise.resolve(
                new SyncPromise((resolve, reject) => {
                    setTimeout(() => {
                        reject('error');
                    }, 1);
                })
            ).catch(error => {
                expect(error).toEqual('error');
                done();
            });
        });
        it('resolves any other thenable to its value', done => {
            SyncPromise.resolve(Promise.resolve(3)).then(value => {
                expect(value).toBe(3);
                done();
            });
        });
    });
    describe('.method', () => {
        it('returns a rejected SyncPromise if a function throws synchronously', () => {
            return SyncPromise.method(() => {
                throw new Error('error');
            }).catch(error => {
                expect(error).toMatchObject({
                    message: 'error'
                });
            });
        });
        it('returns the result as a SyncPromise if a function returns synchronously', done => {
            SyncPromise.method(() => 1)
                .then(result => {
                    expect(result).toBe(1);
                })
                .then(done);
        });
        it('returns the result as a SyncPromise if a function returns a promise', done => {
            SyncPromise.method(() => SyncPromise.delay(1).then(() => 2))
                .then(result => {
                    expect(result).toBe(2);
                })
                .then(done);
        });
        it('returns a rejecting SyncPromise if a function returns a rejecting promise', () => {
            return SyncPromise.method(() =>
                SyncPromise.delay(1).then(() => {
                    throw new Error('error');
                })
            ).catch(error => {
                expect(error).toMatchObject({
                    message: 'error'
                });
            });
        });
    });
    describe('.all', () => {
        it('resolves all futures before resolving', done => {
            const f = SyncPromise.all([SyncPromise.resolve(1), SyncPromise.resolve(2)]);
            f.then(values => {
                expect(values).toEqual([1, 2]);
                done();
            });
        });
        it('resolves an empty list of futures', done => {
            const f = SyncPromise.all([]);
            f.then(values => {
                expect(values).toEqual([]);
                done();
            });
        });
        it('accepts non-array iterables', () => {
            function* gen() {
                yield 1;
                yield SyncPromise.delay(1).then(() => 2);
                yield 3;
            }

            return SyncPromise.all(gen()).then(values => {
                expect(values).toEqual([1, 2, 3]);
            });
        });
    });
    describe('.race', () => {
        it('resolves to the first resolving promise', () => {
            const short = SyncPromise.delay(1).then(() => 1);
            const long = SyncPromise.delay(2000).then(() => 2);
            return SyncPromise.all([SyncPromise.race([short, long]).then(
                result => {
                    expect(result).toBe(1);
                }
            ), long]);
        });
        it('rejects if the first settled promise is rejected', () => {
            const short = SyncPromise.delay(1).then(() => {
                throw new Error('error');
            });
            const long = SyncPromise.delay(2000).then(() => 2);
            return SyncPromise.all([SyncPromise.race([short])
                .catch(error => {
                    expect(error).toMatchObject({
                        message: 'error'
                    });
                    return 'error';
                })
                .then(result => {
                    expect(result).toBe('error');
                }), long]);
        });
        it('accepts non-promise values', () => {
            return SyncPromise.race([SyncPromise.defer().then(() => 1), 2, 3]).then(result => {
                expect(result).toBe(2);
            });
        });
        it('does not settle the returned promise when an empty list of values is passed in', () => {
            const result = SyncPromise.race([]);
            return SyncPromise.delay(20).then(() => {
                expect(result.isPending()).toBeTruthy();
            });
        });
        it('accepts non-array iterables', () => {
            function* gen() {
                yield SyncPromise.delay(1).then(() => 1);
                yield 2;
                yield 3;
            }

            return SyncPromise.race(gen()).then(value => {
                expect(value).toBe(2);
            });
        });
    });
    describe('.reduce', () => {
        it('takes an array of promises and waits for promises returned by the reducer function, passing through the accumulated expression', done => {
            SyncPromise.reduce<number, number>(
                [SyncPromise.defer().then(() => 1), SyncPromise.defer().then(() => 2)],
                (acc, value) => acc + value,
                0
            ).then(sum => {
                expect(sum).toBe(3);
                done();
            });
        });
    });
    describe('.waterfall', () => {
        it('takes an array of promises and waits for promises returned by the reducer function', done => {
            let sum = 0;
            SyncPromise.waterfall([SyncPromise.defer().then(() => 1), SyncPromise.defer().then(() => 2)], value => {
                sum += value;
            }).then(() => {
                expect(sum).toBe(3);
                done();
            });
        });
    });
    it('supports chaining of .then with a non-SyncPromise value', done => {
        SyncPromise.resolve(1)
            .then(value => {
                expect(value).toEqual(1);
                return 2;
            })
            .then(value => {
                expect(value).toEqual(2);
                done();
            });
    });
    it('supports chaining of .then with a new SyncPromise', done => {
        new SyncPromise((resolve, reject) => {
            setTimeout(() => resolve(1), 5);
        })
            .then(value => {
                expect(value).toEqual(1);
                return new SyncPromise((resolve, reject) => {
                    setTimeout(() => resolve(2), 5);
                });
            })
            .then(value => {
                expect(value).toEqual(2);
                done();
            });
    });
    it('forwards exceptions through a .then chain', done => {
        SyncPromise.reject('error')
            .then(() => {
                return 1;
            })
            .catch(error => {
                expect(error).toEqual('error');
                done();
            });
    });
    it('rejects on exceptions in the executor', done => {
        new SyncPromise((resolve, reject) => {
            throw new Error('error');
        }).catch(error => {
            expect(error).toMatchObject({
                message: 'error'
            });
            done();
        });
    });
    it('rejects on exceptions in handlers', done => {
        SyncPromise.resolve(1)
            .then(value => {
                throw new Error('error');
            })
            .catch(error => {
                expect(error).toMatchObject({
                    message: 'error'
                });
                throw new Error('error2');
            })
            .catch(error => {
                expect(error).toMatchObject({
                    message: 'error2'
                });
                return 2;
            })
            .then(value => {
                expect(value).toEqual(2);
                done();
            });
    });
    it('waits for fulfilled promises transparently', done => {
        SyncPromise.resolve()
            .then(() => {
                return new SyncPromise(resolve => {
                    resolve(
                        new SyncPromise(resolve2 => {
                            resolve2(SyncPromise.resolve(42));
                        })
                    );
                });
            })
            .then(value => {
                expect(value).toBe(42);
            })
            .then(done);
    });
    it('waits for rejected promises transparently', done => {
        SyncPromise.resolve()
            .then(() => {
                return new SyncPromise(resolve => {
                    resolve(
                        new SyncPromise(resolve2 => {
                            resolve2(SyncPromise.reject('error'));
                        })
                    );
                });
            })
            .catch(error => {
                expect(error).toBe('error');
                done();
            });
    });
    it('supports .catch', done => {
        const handler = jest.fn();
        new SyncPromise((resolve, reject) => {
            reject(42);
        })
            .catch(handler)
            .then(() => {
                expect(handler).toHaveBeenCalledWith(42);
                done();
            });
    });
    it('propagates errors in .catch', done => {
        SyncPromise.reject('error')
            .catch(error => {
                expect(error).toEqual('error');
                throw new Error('error2');
            })
            .catch(error => {
                expect(error).toMatchObject({
                    message: 'error2'
                });
                done();
            });
    });
    describe('.catch', () => {
        it('does not affect successful promises', done => {
            SyncPromise.resolve(42)
                .catch(() => {})
                .then(result => {
                    expect(result).toBe(42);
                })
                .then(done);
        });
        it('waits for returned promises', done => {
            SyncPromise.reject('error')
                .catch(error => {
                    return SyncPromise.defer().then(() => 42);
                })
                .then(result => {
                    expect(result).toBe(42);
                })
                .then(done);
        });
        it('waits for returned promises that resolve to promises themselves', done => {
            SyncPromise.reject('error')
                .catch(error => {
                    return new SyncPromise(resolve => {
                        resolve(SyncPromise.resolve(42));
                    });
                })
                .then(result => {
                    expect(result).toBe(42);
                })
                .then(done);
        });
    });
    describe('.delay', () => {
        it('waits until executing a callback function', done => {
            SyncPromise.delay(1).then(done);
        });
    });
    describe('.defer', () => {
        it('defers execution of a callback function until the next execution frame', done => {
            SyncPromise.defer().then(done);
        });
    });
    it('executes sync handlers when the SyncPromise is resolved synchronously', done => {
        const handler = jest.fn();
        new SyncPromise(resolve => resolve(1)).thenAsync(handler).thenSync(value => {
            expect(value).toEqual(1);
            expect(handler).not.toHaveBeenCalled();
            done();
        });
    });
    it('executes async handlers when the SyncPromise is resolved asynchronously', done => {
        const handler = jest.fn();
        new SyncPromise(resolve => {
            setTimeout(() => {
                resolve(44);
            }, 0);
        })
            .thenSync(handler)
            .thenAsync(value => {
                expect(handler).not.toHaveBeenCalled();
                done();
            });
    });
    it('handles errors in .thenSync', done => {
        SyncPromise.resolve(42)
            .thenSync(() => {
                throw new Error('error');
            })
            .thenAsync(
                () => {},
                () => {}
            )
            .catch(error => {
                expect(error).toMatchObject({
                    message: 'error'
                });
            })
            .then(done);
    });
    it('calls the onAsyncStart callback before resolving asynchronously', done => {
        const p = SyncPromise.delay(10);
        let started = false;
        p.thenAsync(
            value => {
                expect(started).toBe(true);
                done();
            },
            () => {
                started = true;
            }
        );
        expect(started).toBe(true);
    });
    it('catches errors in the onAsyncStart callback', done => {
        SyncPromise.delay(10)
            .thenAsync(
                () => {},
                () => {
                    throw new Error('error');
                }
            )
            .catchSync(error => {
                expect(error).toMatchObject({
                    message: 'error'
                });
                done();
            });
    });
    describe('(long async specs)', () => {
        const CALL_COUNT = 30000;
        it('supports long .then chains without overflowing the stack', done => {
            let p = SyncPromise.delay().then(() => 0);

            for (let i = 0; i < CALL_COUNT; ++i) {
                p = p.then(value => value + 1);
            }

            p.then(value => {
                expect(value).toBe(CALL_COUNT);
                done();
            });
        });
        it('supports long .then chains returning SyncPromises without overflowing the stack', done => {
            let sameExecutionFrame = true;
            let p = SyncPromise.delay().then(() => 0);

            for (let i = 0; i < CALL_COUNT; ++i) {
                p = p.then(value => SyncPromise.resolve(value + 1));
            }

            p.then(value => {
                expect(value).toBe(CALL_COUNT);
                expect(sameExecutionFrame).toBe(false);
                done();
            });
            sameExecutionFrame = false;
        });
    });
});
