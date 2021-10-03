import typescript from '@rollup/plugin-typescript';

export default {
    input: 'src/SyncPromise.ts',
    output: {
        format: 'cjs',
        dir: 'lib',
        exports: 'default',
        sourcemap: true,
        strict: true
    },
    external: ['process'],
    plugins: [
        typescript()
    ]
};
