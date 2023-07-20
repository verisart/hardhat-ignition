import { ethers } from "ethers";

import { IgnitionValidationError } from "../../../../errors";
import { ArtifactResolver } from "../../../types/artifact";
import {
  ArtifactContractDeploymentFuture,
  ModuleParameters,
} from "../../../types/module";
import { retrieveNestedRuntimeValues } from "../../utils/retrieve-nested-runtime-values";

export async function validateArtifactContractDeployment(
  future: ArtifactContractDeploymentFuture,
  artifactLoader: ArtifactResolver,
  moduleParameters: ModuleParameters
) {
  const moduleParams = retrieveNestedRuntimeValues(future.constructorArgs);

  const missingParams = moduleParams.filter(
    (param) =>
      moduleParameters[param.name] === undefined &&
      param.defaultValue === undefined
  );

  if (missingParams.length > 0) {
    throw new IgnitionValidationError(
      `Module parameter '${missingParams[0].name}' requires a value but was given none`
    );
  }

  const artifact = await artifactLoader.loadArtifact(future.contractName);

  const argsLength = future.constructorArgs.length;

  const iface = new ethers.utils.Interface(artifact.abi);
  const expectedArgsLength = iface.deploy.inputs.length;

  if (argsLength !== expectedArgsLength) {
    throw new IgnitionValidationError(
      `The constructor of the contract '${future.contractName}' expects ${expectedArgsLength} arguments but ${argsLength} were given`
    );
  }
}
