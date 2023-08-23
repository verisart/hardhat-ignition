import type { IgnitionModule } from "../types/module";

import { IgnitionError } from "../../errors";
import { isContractFuture } from "../type-guards";
import { ArtifactResolver } from "../types/artifact";
import {
  DeployConfig,
  DeploymentParameters,
  DeploymentResult,
} from "../types/deployer";

import { Batcher } from "./batcher";
import { DeploymentLoader } from "./deployment-loader/types";
import {
  initializeDeploymentState,
  loadDeploymentState,
} from "./new-execution/deployment-state-helpers";
import { ExecutionEngine } from "./new-execution/execution-engine";
import { JsonRpcClient } from "./new-execution/jsonrpc-client";
import { DeploymentState } from "./new-execution/types/deployment-state";
import { ExecutionState } from "./new-execution/types/execution-state";
import { ExecutionStrategy } from "./new-execution/types/execution-strategy";
import { Reconciler } from "./reconciliation/reconciler";
import { isContractExecutionStateArray } from "./type-guards";
import { assertIgnitionInvariant } from "./utils/assertions";
import { getFuturesFromModule } from "./utils/get-futures-from-module";
import { validateStageTwo } from "./validation/validateStageTwo";

/**
 * Run an Igntition deployment.
 *
 * @beta
 */
export class Deployer {
  constructor(
    private readonly _config: DeployConfig,
    private readonly _executionStrategy: ExecutionStrategy,
    private readonly _jsonRpcClient: JsonRpcClient,
    private readonly _artifactResolver: ArtifactResolver,
    private readonly _deploymentLoader: DeploymentLoader
  ) {
    assertIgnitionInvariant(
      this._config.requiredConfirmations >= 1,
      `Configured value 'blockConfirmations' cannot be less than 1. Value given: '${this._config.requiredConfirmations}'`
    );
  }

  public async deploy(
    ignitionModule: IgnitionModule,
    deploymentParameters: DeploymentParameters,
    accounts: string[],
    fallbackSender: string
  ): Promise<DeploymentResult> {
    await validateStageTwo(
      ignitionModule,
      this._artifactResolver,
      deploymentParameters,
      accounts
    );

    let deploymentState = await this._getOrInitializeDeploymentState();

    const contracts =
      getFuturesFromModule(ignitionModule).filter(isContractFuture);

    const contractStates = contracts
      .map((contract) => deploymentState?.executionStates[contract.id])
      .filter((v): v is ExecutionState => v !== undefined);

    // realistically this should be impossible to fail.
    // just need it here for the type inference
    assertIgnitionInvariant(
      isContractExecutionStateArray(contractStates),
      "Invalid state map"
    );

    const reconciliationResult = await Reconciler.reconcile(
      ignitionModule,
      deploymentState,
      deploymentParameters,
      accounts,
      this._deploymentLoader,
      this._artifactResolver,
      fallbackSender
    );

    if (reconciliationResult.reconciliationFailures.length > 0) {
      const failures = reconciliationResult.reconciliationFailures
        .map((rf) => `  ${rf.futureId} - ${rf.failure}`)
        .join("\n");

      throw new IgnitionError(`Reconciliation failed\n\n${failures}`);
    }

    if (reconciliationResult.missingExecutedFutures.length > 0) {
      // TODO: indicate to UI that warnings should be shown
    }

    const batches = Batcher.batch(ignitionModule, deploymentState);

    const executionEngine = new ExecutionEngine(
      this._deploymentLoader,
      this._artifactResolver,
      this._executionStrategy,
      this._jsonRpcClient,
      this._config.requiredConfirmations,
      this._config.timeBeforeBumpingFees,
      this._config.maxFeeBumps,
      this._config.blockPollingInterval
    );

    deploymentState = await executionEngine.executeModule(
      deploymentState,
      ignitionModule,
      batches,
      accounts,
      deploymentParameters,
      fallbackSender
    );

    return this._getDeploymentResult(deploymentState);
  }

  private async _getDeploymentResult(
    _deploymentState: DeploymentState
  ): Promise<DeploymentResult> {
    // TODO: Create the deployment result
    return null as any;
  }

  private async _getOrInitializeDeploymentState(): Promise<DeploymentState> {
    const chainId = await this._jsonRpcClient.getChainId();
    const deploymentState = await loadDeploymentState(this._deploymentLoader);

    if (deploymentState === undefined) {
      return initializeDeploymentState(chainId, this._deploymentLoader);
    }

    assertIgnitionInvariant(
      deploymentState.chainId === chainId,
      `Trying to continue deployment in a different chain. Previous chain id: ${deploymentState.chainId}. Current chain id: ${chainId}`
    );

    return deploymentState;
  }
}
