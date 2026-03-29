import { useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { BuilderTab } from './BuilderTab';
import { useBuilderController } from '../useBuilderController';
import { useBuilderSubmitController } from '../useBuilderSubmitController';

type RawOperationsTabProps = {
  viewApiBaseUrl: string;
};

export function RawOperationsTab({ viewApiBaseUrl }: RawOperationsTabProps) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [isWorking, setIsWorking] = useState(false);
  const builder = useBuilderController('raw');

  const { handleBuilderSubmit } = useBuilderSubmitController({
    connection,
    wallet,
    viewApiBaseUrl,
    pushMessage: () => {},
    setIsBuilderWorking: setIsWorking,
    builderProtocolId: builder.builderProtocolId,
    selectedBuilderOperation: builder.selectedBuilderOperation,
    selectedBuilderOperationEnhancement: builder.selectedBuilderOperationEnhancement,
    builderInputValues: builder.builderInputValues,
    onSetBuilderInputValue: builder.handleBuilderInputChange,
    builderViewMode: builder.builderViewMode,
    selectedBuilderAppStep: builder.selectedBuilderAppStep,
    selectedBuilderApp: builder.selectedBuilderApp,
    builderAppStepIndex: builder.builderAppStepIndex,
    setBuilderAppStepCompleted: builder.setBuilderAppStepCompleted,
    clearBuilderAppProgressFrom: builder.clearBuilderAppProgressFrom,
    setBuilderStatusText: builder.setBuilderStatusText,
    setBuilderRawDetails: builder.setBuilderRawDetails,
    setBuilderShowRawDetails: builder.setBuilderShowRawDetails,
    applyBuilderAppStepResult: builder.applyBuilderAppStepResult,
    getBuilderStepStatusText: builder.getBuilderStepStatusText,
    setBuilderResult: builder.setBuilderResult,
    isBuilderAppMode: false,
    builderAppSubmitMode: builder.builderAppSubmitMode,
    builderSimulate: builder.builderSimulate,
  });

  return (
    <BuilderTab
      isWorking={isWorking}
      builderViewMode="raw"
      builderProtocols={builder.builderProtocols}
      builderProtocolLabelsById={builder.builderProtocolLabelsById}
      builderProtocolId={builder.builderProtocolId}
      onSelectProtocol={builder.handleBuilderProtocolSelect}
      builderApps={[]}
      builderAppId=""
      onSelectApp={() => {}}
      builderOperations={builder.builderOperations}
      builderOperationId={builder.builderOperationId}
      onSelectOperation={builder.handleBuilderOperationSelect}
      selectedBuilderOperation={builder.selectedBuilderOperation}
      selectedBuilderOperationEnhancement={builder.selectedBuilderOperationEnhancement}
      builderOperationLabelsByOperationId={builder.builderOperationLabelsByOperationId}
      selectedBuilderApp={null}
      builderAppLabelsByAppId={{}}
      builderStepLabelsByAppStepKey={{}}
      selectedBuilderStepActions={[]}
      builderAppStepIndex={0}
      canOpenBuilderAppStep={() => false}
      onOpenBuilderAppStep={() => {}}
      showBuilderSelectableItems={false}
      onBackStep={() => {}}
      onResetStep={() => {}}
      selectedBuilderAppSelectUi={null}
      selectedBuilderAppSelectableItems={[]}
      selectedBuilderSelectedItemValue={null}
      onSelectItem={() => {}}
      visibleBuilderInputs={builder.visibleBuilderInputs}
      builderInputValues={builder.builderInputValues}
      onInputChange={builder.handleBuilderInputChange}
      onPrefillExample={builder.handleBuilderPrefillExample}
      isBuilderAppMode={false}
      builderAppSubmitMode={builder.builderAppSubmitMode}
      onSetBuilderAppSubmitMode={builder.setBuilderAppSubmitMode}
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
