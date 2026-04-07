import { useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { BuilderTab } from './BuilderTab';
import { useBuilderController } from '../useBuilderController';
import { useBuilderSubmitController } from '../useBuilderSubmitController';

export function RawOperationsTab() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [isWorking, setIsWorking] = useState(false);
  const builder = useBuilderController();

  const { handleBuilderSubmit } = useBuilderSubmitController({
    connection,
    wallet,
    pushMessage: () => {},
    setIsBuilderWorking: setIsWorking,
    builderProtocolId: builder.builderProtocolId,
    selectedBuilderOperation: builder.selectedBuilderOperation,
    selectedBuilderOperationEnhancement: builder.selectedBuilderOperationEnhancement,
    builderInputValues: builder.builderInputValues,
    onSetBuilderInputValue: builder.handleBuilderInputChange,
    setBuilderStatusText: builder.setBuilderStatusText,
    setBuilderRawDetails: builder.setBuilderRawDetails,
    setBuilderShowRawDetails: builder.setBuilderShowRawDetails,
    setBuilderResult: builder.setBuilderResult,
    builderSimulate: builder.builderSimulate,
  });

  return (
    <BuilderTab
      isWorking={isWorking}
      builderProtocols={builder.builderProtocols}
      builderProtocolId={builder.builderProtocolId}
      onSelectProtocol={builder.handleBuilderProtocolSelect}
      builderOperations={builder.builderOperations}
      builderOperationId={builder.builderOperationId}
      onSelectOperation={builder.handleBuilderOperationSelect}
      selectedBuilderOperation={builder.selectedBuilderOperation}
      selectedBuilderOperationEnhancement={builder.selectedBuilderOperationEnhancement}
      visibleBuilderInputs={builder.visibleBuilderInputs}
      builderInputValues={builder.builderInputValues}
      onInputChange={builder.handleBuilderInputChange}
      onPrefillExample={builder.handleBuilderPrefillExample}
      builderSimulate={builder.builderSimulate}
      onSetBuilderSimulate={builder.setBuilderSimulate}
      onSubmit={handleBuilderSubmit}
      builderStatusText={builder.builderStatusText}
      builderRawDetails={builder.builderRawDetails}
      builderShowRawDetails={builder.builderShowRawDetails}
      onToggleRawDetails={builder.handleBuilderToggleRawDetails}
    />
  );
}
