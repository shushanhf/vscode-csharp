/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as gulp from 'gulp';
import * as path from 'path';
import { codeExtensionPath, rootPath, outPath } from './projectPaths';
import spawnNode from './spawnNode';
import * as jest from 'jest';
import { Config } from '@jest/types';
import { jestOmniSharpUnitTestProjectName } from '../omnisharptest/omnisharpUnitTests/jest.config';
import { jestUnitTestProjectName } from '../test/unitTests/jest.config';
import { razorTestProjectName } from '../test/razorTests/jest.config';
import { jestArtifactTestsProjectName } from '../test/artifactTests/jest.config';

gulp.task('test:razor', async () => {
    runJestTest(razorTestProjectName);
});

const razorIntegrationTestProjects = ['BasicRazorApp2_1'];
for (const projectName of razorIntegrationTestProjects) {
    gulp.task(`test:razorintegration:${projectName}`, async () => runIntegrationTest(projectName, /* razor */ true));
}

gulp.task(
    'test:razorintegration',
    gulp.series(razorIntegrationTestProjects.map((projectName) => `test:razorintegration:${projectName}`))
);

gulp.task('test:artifacts', async () => {
    runJestTest(jestArtifactTestsProjectName);
});

gulp.task('omnisharptest:unit', async () => {
    await runJestTest(jestOmniSharpUnitTestProjectName);
});

const omnisharpIntegrationTestProjects = ['singleCsproj', 'slnWithCsproj', 'slnFilterWithCsproj', 'BasicRazorApp2_1'];

for (const projectName of omnisharpIntegrationTestProjects) {
    gulp.task(`omnisharptest:integration:${projectName}:stdio`, async () =>
        runOmnisharpJestIntegrationTest(projectName, 'stdio')
    );
    gulp.task(`omnisharptest:integration:${projectName}:lsp`, async () =>
        runOmnisharpJestIntegrationTest(projectName, 'lsp')
    );
    gulp.task(
        `omnisharptest:integration:${projectName}`,
        gulp.series(`omnisharptest:integration:${projectName}:stdio`, `omnisharptest:integration:${projectName}:lsp`)
    );
}

gulp.task(
    'omnisharptest:integration',
    gulp.series(omnisharpIntegrationTestProjects.map((projectName) => `omnisharptest:integration:${projectName}`))
);
gulp.task(
    'omnisharptest:integration:stdio',
    gulp.series(omnisharpIntegrationTestProjects.map((projectName) => `omnisharptest:integration:${projectName}:stdio`))
);
gulp.task(
    'omnisharptest:integration:lsp',
    gulp.series(omnisharpIntegrationTestProjects.map((projectName) => `omnisharptest:integration:${projectName}:lsp`))
);
// TODO: Enable lsp integration tests once tests for unimplemented features are disabled.
gulp.task('omnisharptest', gulp.series('omnisharptest:unit', 'omnisharptest:integration:stdio'));

gulp.task('test:unit', async () => {
    await runJestTest(jestUnitTestProjectName);
});

const integrationTestProjects = ['slnWithCsproj'];
for (const projectName of integrationTestProjects) {
    gulp.task(`test:integration:${projectName}`, async () => runIntegrationTest(projectName));
}

gulp.task(
    'test:integration',
    gulp.series(integrationTestProjects.map((projectName) => `test:integration:${projectName}`))
);

gulp.task('test', gulp.series('test:unit', 'test:integration', 'test:razor', 'test:razorintegration'));

async function runOmnisharpJestIntegrationTest(testAssetName: string, engine: 'stdio' | 'lsp') {
    const workspaceFile = `omnisharp${engine === 'lsp' ? '_lsp' : ''}_${testAssetName}.code-workspace`;
    const testFolder = path.join('omnisharptest', 'omnisharpIntegrationTests');

    const env = {
        OSVC_SUITE: testAssetName,
        CODE_EXTENSIONS_PATH: codeExtensionPath,
        CODE_WORKSPACE_ROOT: rootPath,
        OMNISHARP_ENGINE: engine,
        OMNISHARP_LOCATION: process.env.OMNISHARP_LOCATION,
        CODE_DISABLE_EXTENSIONS: 'true',
    };

    await runJestIntegrationTest(testAssetName, testFolder, workspaceFile, env);
}

async function runIntegrationTest(testAssetName: string, razor = false) {
    const vscodeWorkspaceFileName = `lsp_tools_host_${testAssetName}.code-workspace`;
    const testFolder = path.join('test', razor ? 'razorIntegrationTests' : 'integrationTests');
    return await runJestIntegrationTest(testAssetName, testFolder, vscodeWorkspaceFileName);
}

/**
 * Runs jest based integration tests.
 * @param testAssetName the name of the test asset
 * @param testFolderName the relative path (from workspace root)
 * @param workspaceFileName the name of the vscode workspace file to use.
 * @param env any environment variables needed.
 */
async function runJestIntegrationTest(
    testAssetName: string,
    testFolderName: string,
    workspaceFileName: string,
    env: NodeJS.ProcessEnv = {}
) {
    // Test assets are always in a testAssets folder inside the integration test folder.
    const assetsPath = path.join(rootPath, testFolderName, 'testAssets');
    if (!fs.existsSync(assetsPath)) {
        throw new Error(`Could not find test assets at ${assetsPath}`);
    }
    const workspacePath = path.join(assetsPath, testAssetName, '.vscode', workspaceFileName);
    if (!fs.existsSync(workspacePath)) {
        throw new Error(`Could not find vscode workspace to open at ${workspacePath}`);
    }

    // The launcher (that downloads and opens vscode) is always compiled to out/test/vscodeLauncher.js
    const launcherPath = path.join(outPath, 'test', 'vscodeLauncher.js');
    if (!fs.existsSync(launcherPath)) {
        throw new Error('Could not find test runner in out/ directory');
    }
    // The runner (that loads in the vscode process to run tests) is in the test folder in the *output* directory.
    const vscodeRunnerPath = path.join(outPath, testFolderName, 'index.js');
    if (!fs.existsSync(vscodeRunnerPath)) {
        throw new Error(`Could not find vscode runner in out/ at ${vscodeRunnerPath}`);
    }

    env.CODE_TESTS_WORKSPACE = workspacePath;
    env.CODE_EXTENSIONS_PATH = rootPath;
    env.EXTENSIONS_TESTS_PATH = vscodeRunnerPath;

    const result = await spawnNode([launcherPath, '--enable-source-maps'], { env, cwd: rootPath });

    if (result.code === null || result.code > 0) {
        // Ensure that gulp fails when tests fail
        throw new Error(`Exit code: ${result.code}  Signal: ${result.signal}`);
    }

    return result;
}

async function runJestTest(project: string) {
    const configPath = path.join(rootPath, 'jest.config.ts');
    const { results } = await jest.runCLI(
        {
            config: configPath,
            selectProjects: [project],
            verbose: true,
        } as Config.Argv,
        [project]
    );

    if (!results.success) {
        throw new Error('Tests failed.');
    }
}
