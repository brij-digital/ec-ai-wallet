import { useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { BuilderTab } from './BuilderTab';
import { useBuilderController } from '../useBuilderController';
import { useBuilderSubmitController } from '../useBuilderSubmitController';

type AppsTabProps = {
  viewApiBaseUrl: string;
};

export function AppsTab({ viewApiBaseUrl }: AppsTabProps) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [isWorking, setIsWorking] = useState(false);
  const builder = useBuilderController('forms');

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
    isBuilderAppMode: builder.isBuilderAppMode,
    builderAppSubmitMode: builder.builderAppSubmitMode,
    builderSimulate: builder.builderSimulate,
  });

  return (
    <BuilderTab
      isWorking={isWorking}
      builderViewMode="forms"
      builderProtocols={builder.builderProtocols}
      builderProtocolLabelsById={builder.builderProtocolLabelsById}
      builderProtocolId={builder.builderProtocolId}
      onSelectProtocol={builder.handleBuilderProtocolSelect}
      builderApps={builder.builderApps}
      builderAppId={builder.builderAppId}
      onSelectApp={builder.handleBuilderAppSelect}
      builderOperations={builder.builderOperations}
      builderOperationId={builder.builderOperationId}
      onSelectOperation={builder.handleBuilderOperationSelect}
      selectedBuilderOperation={builder.selectedBuilderOperation}
      selectedBuilderOperationEnhancement={builder.selectedBuilderOperationEnhancement}
      builderOperationLabelsByOperationId={builder.builderOperationLabelsByOperationId}
      selectedBuilderApp={builder.selectedBuilderApp}
      builderAppLabelsByAppId={builder.builderAppLabelsByAppId}
      builderStepLabelsByAppStepKey={builder.builderStepLabelsByAppStepKey}
      selectedBuilderStepActions={builder.selectedBuilderStepActions}
      builderAppStepIndex={builder.builderAppStepIndex}
      canOpenBuilderAppStep={builder.canOpenBuilderAppStep}
      onOpenBuilderAppStep={builder.handleBuilderAppOpenStep}
      showBuilderSelectableItems={builder.showBuilderSelectableItems}
      onBackStep={builder.handleBuilderAppBackStep}
      onResetStep={builder.handleBuilderAppResetCurrentStep}
      selectedBuilderAppSelectUi={builder.selectedBuilderAppSelectUi}
      selectedBuilderAppSelectableItems={builder.selectedBuilderAppSelectableItems}
      selectedBuilderSelectedItemValue={builder.selectedBuilderSelectedItemValue}
      onSelectItem={builder.handleBuilderAppSelectItem}
      visibleBuilderInputs={builder.visibleBuilderInputs}
      builderInputValues={builder.builderInputValues}
      onInputChange={builder.handleBuilderInputChange}
      onPrefillExample={builder.handleBuilderPrefillExample}
      isBuilderAppMode={builder.isBuilderAppMode}
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
