import * as ko from "knockout";
import * as React from "react";

import { probablyUniqueString } from "../../common/Toolbox";
import { Combatant } from "../Combatant/Combatant";
import { CombatantViewModel } from "../Combatant/CombatantViewModel";
import { StatBlockComponent } from "../Components/StatBlock";
import { Dice, RollResult } from "../Rules/Rules";
import { CurrentSettings } from "../Settings/Settings";
import { TrackerViewModel } from "../TrackerViewModel";
import { Metrics } from "../Utility/Metrics";
import { Store } from "../Utility/Store";
import { BuildCombatantCommandList } from "./BuildCombatantCommandList";
import { Command } from "./Command";
import { AcceptDamagePrompt } from "./Prompts/AcceptDamagePrompt";
import { ConcentrationPrompt } from "./Prompts/ConcentrationPrompt";
import { DefaultPrompt } from "./Prompts/Prompt";
import { TagPromptWrapper } from "./Prompts/TagPrompt";

interface PendingLinkInitiative {
    combatant: CombatantViewModel;
    prompt: DefaultPrompt;
}

export class CombatantCommander {
    constructor(private tracker: TrackerViewModel) {
        this.Commands = BuildCombatantCommandList(this);
    }

    public Commands: Command[];
    public SelectedCombatants: KnockoutObservableArray<CombatantViewModel> = ko.observableArray<CombatantViewModel>([]);

    public HasSelected = ko.pureComputed(() => this.SelectedCombatants().length > 0);
    public HasOneSelected = ko.pureComputed(() => this.SelectedCombatants().length === 1);
    public HasMultipleSelected = ko.pureComputed(() => this.SelectedCombatants().length > 1);

    public StatBlock = ko.pureComputed(() => {
        let selectedCombatants = this.SelectedCombatants();
        if (selectedCombatants.length == 1) {
            return React.createElement(StatBlockComponent, {
                statBlock: selectedCombatants[0].Combatant.StatBlock(),
                enricher: this.tracker.StatBlockTextEnricher,
                displayMode: "default"
            });
        } else {
            return null;
        }
    });

    public Names: KnockoutComputed<string> = ko.pureComputed(() =>
        this.SelectedCombatants()
            .map(c => c.Name())
            .join(", ")
    );

    private latestRoll: RollResult;

    public Select = (data: CombatantViewModel, e?: MouseEvent) => {
        if (!data) {
            return;
        }
        const pendingLink = this.pendingLinkInitiative();
        if (pendingLink) {
            this.linkCombatantInitiatives([data, pendingLink.combatant]);
            pendingLink.prompt.Resolve(null);
        }
        if (!(e && e.ctrlKey || e && e.metaKey)) {
            this.SelectedCombatants.removeAll();
        }
        this.SelectedCombatants.push(data);
    }

    private selectByOffset = (offset: number) => {
        let newIndex = this.tracker.CombatantViewModels().indexOf(this.SelectedCombatants()[0]) + offset;
        if (newIndex < 0) {
            newIndex = 0;
        } else if (newIndex >= this.tracker.CombatantViewModels().length) {
            newIndex = this.tracker.CombatantViewModels().length - 1;
        }
        this.SelectedCombatants.removeAll();
        this.SelectedCombatants.push(this.tracker.CombatantViewModels()[newIndex]);
    }

    public Remove = () => {
        const combatantsToRemove = this.SelectedCombatants.removeAll(),
            firstDeletedIndex = this.tracker.CombatantViewModels().indexOf(combatantsToRemove[0]),
            deletedCombatantNames = combatantsToRemove.map(c => c.Combatant.StatBlock().Name);

        if (this.tracker.CombatantViewModels().length > combatantsToRemove.length) {
            let activeCombatant = this.tracker.Encounter.ActiveCombatant();
            while (combatantsToRemove.some(c => c.Combatant === activeCombatant)) {
                this.tracker.Encounter.NextTurn();
                activeCombatant = this.tracker.Encounter.ActiveCombatant();
            }
        }

        this.tracker.Encounter.RemoveCombatantsByViewModel(combatantsToRemove);

        const remainingCombatants = this.tracker.CombatantViewModels();

        let allMyFriendsAreGone = name => remainingCombatants.every(c => c.Combatant.StatBlock().Name != name);

        deletedCombatantNames.forEach(name => {
            if (allMyFriendsAreGone(name)) {
                const combatantCountsByName = this.tracker.Encounter.CombatantCountsByName();
                delete combatantCountsByName[name];
                this.tracker.Encounter.CombatantCountsByName(combatantCountsByName);
            }
        });

        if (remainingCombatants.length > 0) {
            const newSelectionIndex =
                firstDeletedIndex > remainingCombatants.length ?
                    remainingCombatants.length - 1 :
                    firstDeletedIndex;
            this.Select(this.tracker.CombatantViewModels()[newSelectionIndex]);
        } else {
            this.tracker.Encounter.EndEncounter();
        }

        this.tracker.EventLog.AddEvent(`${deletedCombatantNames.join(", ")} removed from encounter.`);
        Metrics.TrackEvent("CombatantsRemoved", { Names: deletedCombatantNames });

        this.tracker.Encounter.QueueEmitEncounter();
    }

    public Deselect = () => {
        this.SelectedCombatants([]);
    }

    public SelectPrevious = () => {
        this.selectByOffset(-1);
    }

    public SelectNext = () => {
        this.selectByOffset(1);
    }

    private CreateEditHPCallback = (combatants: CombatantViewModel[], combatantNames: string) => {
        return (response) => {
            const damage = response["damage"];
            if (damage) {
                combatants.forEach(c => c.ApplyDamage(damage));
                const damageNum = parseInt(damage);
                this.tracker.EventLog.LogHPChange(damageNum, combatantNames);
                this.tracker.Encounter.QueueEmitEncounter();
            }
        };
    }

    public EditHP = () => {
        const selectedCombatants = this.SelectedCombatants();
        const combatantNames = selectedCombatants.map(c => c.Name()).join(", ");
        const callback = this.CreateEditHPCallback(selectedCombatants, combatantNames);
        const latestRollTotal = this.latestRoll && this.latestRoll.Total;
        const prompt = new DefaultPrompt(`Apply damage to ${combatantNames}: <input id='damage' class='response' type='number' value='${latestRollTotal}'/>`, callback);
        this.tracker.PromptQueue.Add(prompt);
        return false;
    }

    public SuggestEditHP = (suggestedCombatants: CombatantViewModel[], suggestedDamage: number, suggester: string) => {
        const allowPlayerSuggestions = CurrentSettings().PlayerView.AllowPlayerSuggestions;

        if (!allowPlayerSuggestions) {
            return false;
        }

        const prompt = new AcceptDamagePrompt(suggestedCombatants, suggestedDamage, suggester, this.tracker);

        this.tracker.PromptQueue.Add(prompt);
        return false;
    }

    public CheckConcentration = (combatant: Combatant, damageAmount: number) => {
        setTimeout(() => {
            const prompt = new ConcentrationPrompt(combatant, damageAmount);
            this.tracker.PromptQueue.Add(prompt);
        }, 1);
    }

    public AddTemporaryHP = () => {
        const selectedCombatants = this.SelectedCombatants();
        const combatantNames = selectedCombatants.map(c => c.Name()).join(", ");
        const prompt = new DefaultPrompt(`Grant temporary hit points to ${combatantNames}: <input id='thp' class='response' type='number' />`,
            response => {
                const thp = response["thp"];
                if (thp) {
                    selectedCombatants.forEach(c => c.ApplyTemporaryHP(thp));
                    this.tracker.EventLog.AddEvent(`${thp} temporary hit points granted to ${combatantNames}.`);
                    Metrics.TrackEvent("TemporaryHPAdded", { Amount: thp });
                    this.tracker.Encounter.QueueEmitEncounter();
                }
            });
        this.tracker.PromptQueue.Add(prompt);

        return false;
    }

    public AddTag = (combatantVM?: CombatantViewModel) => {
        if (combatantVM instanceof CombatantViewModel) {
            this.Select(combatantVM);
        }
        const selectedCombatants = this.SelectedCombatants().map(c => c.Combatant);
        const prompt = new TagPromptWrapper(this.tracker.Encounter, selectedCombatants, this.tracker.EventLog.AddEvent);
        this.tracker.PromptQueue.Add(prompt);
        return false;
    }

    public EditInitiative = () => {
        this.SelectedCombatants().forEach(c => c.EditInitiative());
        return false;
    }

    private pendingLinkInitiative = ko.observable<PendingLinkInitiative>(null);

    private linkCombatantInitiatives = (combatants: CombatantViewModel[]) => {
        this.pendingLinkInitiative(null);
        const highestInitiative = combatants.map(c => c.Combatant.Initiative()).sort((a, b) => b - a)[0];
        const initiativeGroup = probablyUniqueString();

        combatants.forEach(s => {
            s.Combatant.Initiative(highestInitiative);
            s.Combatant.InitiativeGroup(initiativeGroup);
        });
        this.tracker.Encounter.CleanInitiativeGroups();

        this.tracker.Encounter.SortByInitiative();
        Metrics.TrackEvent("InitiativeLinked");
    }

    public LinkInitiative = () => {
        const selected = this.SelectedCombatants();

        if (selected.length <= 1) {
            const message = `<p>Select another combatant to link initiative. <br /><em>Tip:</em> You can select multiple combatants with 'ctrl', then use this command to link them to one shared initiative count.</p>`;
            const prompt = new DefaultPrompt(message, _ => this.pendingLinkInitiative(null));
            this.tracker.PromptQueue.Add(prompt);
            this.pendingLinkInitiative({ combatant: selected[0], prompt: prompt });
            return;
        }

        this.linkCombatantInitiatives(selected);
    }

    public MoveUp = () => {
        const combatant = this.SelectedCombatants()[0];
        const index = this.tracker.CombatantViewModels().indexOf(combatant);
        if (combatant && index > 0) {
            const newInitiative = this.tracker.Encounter.MoveCombatant(combatant.Combatant, index - 1);
            this.tracker.EventLog.AddEvent(`${combatant.Name()} initiative set to ${newInitiative}.`);
        }
    }

    public MoveDown = () => {
        const combatant = this.SelectedCombatants()[0];
        const index = this.tracker.CombatantViewModels().indexOf(combatant);
        if (combatant && index < this.tracker.CombatantViewModels().length - 1) {
            const newInitiative = this.tracker.Encounter.MoveCombatant(combatant.Combatant, index + 1);
            this.tracker.EventLog.AddEvent(`${combatant.Name()} initiative set to ${newInitiative}.`);
        }
    }

    public SetAlias = () => {
        this.SelectedCombatants().forEach(c => c.SetAlias());
        return false;
    }

    public EditStatBlock = () => {
        if (this.SelectedCombatants().length == 1) {
            let selectedCombatant = this.SelectedCombatants()[0].Combatant;
            this.tracker.EditStatBlock(
                "combatant",
                selectedCombatant.StatBlock(),
                (newStatBlock) => {
                    selectedCombatant.StatBlock(newStatBlock);
                    this.tracker.Encounter.QueueEmitEncounter();
                },
                undefined,
                () => this.Remove()
            );
        }
    }

    public RollDice = (diceExpression: string) => {
        const diceRoll = Dice.RollDiceExpression(diceExpression);
        this.latestRoll = diceRoll;
        const prompt = new DefaultPrompt(`Rolled: ${diceExpression} -> ${diceRoll.FormattedString} <input class='response' type='number' value='${diceRoll.Total}' />`);
        Metrics.TrackEvent("DiceRolled", { Expression: diceExpression, Result: diceRoll.FormattedString });
        this.tracker.PromptQueue.Add(prompt);
    }
}
