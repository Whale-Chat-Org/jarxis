import { createGatewayModel } from './gateway';
import { createAgentGraph } from './graph';
import { createWebSearch, webSearchTool } from './search';

export function createConfiguredGraph() {
  const gatewayModel = createGatewayModel();
  return createAgentGraph({
    model: gatewayModel.bindTools([webSearchTool]),
    finalModel: gatewayModel,
    search: createWebSearch(),
  });
}
