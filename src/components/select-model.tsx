"use client";

import { appStore } from "@/app/store";
import { useChatModels } from "@/hooks/queries/use-chat-models";
import { ChatModel } from "app-types/chat";
import { CheckIcon, ChevronDown } from "lucide-react";
import { Fragment, PropsWithChildren, memo, useEffect, useState } from "react";
import { Button } from "ui/button";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "ui/command";
import { ModelProviderIcon } from "ui/model-provider-icon";
import { Popover, PopoverContent, PopoverTrigger } from "ui/popover";

interface SelectModelProps {
  onSelect: (model: ChatModel) => void;
  align?: "start" | "end";
  currentModel?: ChatModel;
  showProvider?: boolean;
}

export const SelectModel = (props: PropsWithChildren<SelectModelProps>) => {
  const [open, setOpen] = useState(false);
  const { data: providers } = useChatModels();
  const [model, setModel] = useState(props.currentModel);

  useEffect(() => {
    const modelToUse = props.currentModel ?? appStore.getState().chatModel;

    // If providers haven't loaded yet, don't set model (wait for validation)
    if (!providers || providers.length === 0) {
      // If there's a model but no providers yet, clear it to prevent showing invalid model
      if (modelToUse) {
        setModel(undefined);
      }
      return;
    }

    // Validate that the model exists in available providers
    if (modelToUse) {
      const isValid = providers.some(
        (p) =>
          p.provider === modelToUse.provider &&
          p.hasAPIKey &&
          p.models.some((m) => m.name === modelToUse.model),
      );

      if (isValid) {
        setModel(modelToUse);
      } else {
        // Model is invalid, try to find a valid default
        const firstValidProvider = providers.find(
          (p) => p.hasAPIKey && p.models && p.models.length > 0,
        );
        if (firstValidProvider) {
          const defaultModel = {
            provider: firstValidProvider.provider,
            model: firstValidProvider.models[0].name,
          };
          setModel(defaultModel);
          // Update store if this is the current model
          if (!props.currentModel) {
            appStore.setState({ chatModel: defaultModel });
          }
        } else {
          setModel(undefined);
          // Clear store if no valid models available
          if (!props.currentModel) {
            appStore.setState({ chatModel: undefined });
          }
        }
      }
    } else {
      // No model set, try to find a valid default
      const firstValidProvider = providers.find(
        (p) => p.hasAPIKey && p.models && p.models.length > 0,
      );
      if (firstValidProvider) {
        const defaultModel = {
          provider: firstValidProvider.provider,
          model: firstValidProvider.models[0].name,
        };
        setModel(defaultModel);
        if (!props.currentModel) {
          appStore.setState({ chatModel: defaultModel });
        }
      } else {
        setModel(undefined);
      }
    }
  }, [props.currentModel, providers]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {props.children || (
          <Button
            variant={"secondary"}
            size={"sm"}
            className="data-[state=open]:bg-input! hover:bg-input! "
            data-testid="model-selector-button"
          >
            <div className="mr-auto flex items-center gap-1">
              {(props.showProvider ?? true) && model?.provider && (
                <ModelProviderIcon
                  provider={model.provider}
                  className="size-2.5 mr-1"
                />
              )}
              <p data-testid="selected-model-name">
                {model?.model || "No model selected"}
              </p>
            </div>
            <ChevronDown className="size-3" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-[280px]"
        align={props.align || "end"}
        data-testid="model-selector-popover"
      >
        <Command
          className="rounded-lg relative shadow-md h-80"
          value={JSON.stringify(model)}
          onClick={(e) => e.stopPropagation()}
        >
          <CommandInput
            placeholder="search model..."
            data-testid="model-search-input"
          />
          <CommandList className="p-2">
            <CommandEmpty>
              {providers && providers.length === 0
                ? "No models available. Add API keys in Settings > Models."
                : "No results found."}
            </CommandEmpty>
            {providers && providers.length > 0
              ? providers.map((provider, i) => (
                  <Fragment key={provider.provider}>
                    <CommandGroup
                      heading={<ProviderHeader provider={provider.provider} />}
                      className="pb-4 group"
                      onWheel={(e) => {
                        e.stopPropagation();
                      }}
                      data-testid={`model-provider-${provider.provider}`}
                    >
                      {provider.models.map((item) => (
                        <CommandItem
                          key={item.name}
                          className="cursor-pointer"
                          onSelect={() => {
                            setModel({
                              provider: provider.provider,
                              model: item.name,
                            });
                            props.onSelect({
                              provider: provider.provider,
                              model: item.name,
                            });
                            setOpen(false);
                          }}
                          value={item.name}
                          data-testid={`model-option-${provider.provider}-${item.name}`}
                        >
                          {model?.provider === provider.provider &&
                          model?.model === item.name ? (
                            <CheckIcon
                              className="size-3"
                              data-testid="selected-model-check"
                            />
                          ) : (
                            <div className="ml-3" />
                          )}
                          <span className="pr-1">
                            {(item.displayName || item.name).replace(
                              /:free$/i,
                              "",
                            )}
                          </span>
                          {item.isToolCallUnsupported && (
                            <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                              No tools
                            </div>
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                    {i < providers.length - 1 && <CommandSeparator />}
                  </Fragment>
                ))
              : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

const ProviderHeader = memo(function ProviderHeader({
  provider,
}: { provider: string }) {
  return (
    <div className="text-sm text-muted-foreground flex items-center gap-1.5 group-hover:text-foreground transition-colors duration-300">
      {provider === "openai" ? (
        <ModelProviderIcon
          provider="openai"
          className="size-3 text-foreground"
        />
      ) : (
        <ModelProviderIcon provider={provider} className="size-3" />
      )}
      {provider}
    </div>
  );
});
