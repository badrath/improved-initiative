import * as ko from "knockout";

import { ServerListing } from "../../common/Listable";
import { StatBlock } from "../../common/StatBlock";
import { AccountClient } from "../Account/AccountClient";
import { Store } from "../Utility/Store";
import { Listing, ListingOrigin } from "./Listing";

export class NPCLibrary {
    public StatBlocks = ko.observableArray<Listing<StatBlock>>([]);
    public readonly StoreName = Store.StatBlocks;
    
    constructor(private accountClient: AccountClient) {
        $.ajax("../statblocks/").done(s => this.AddListings(s, "server"));

        const localStatBlocks = Store.List(this.StoreName);
        const listings = localStatBlocks.map(id => {
            let statBlock = { ...StatBlock.Default(), ...Store.Load<StatBlock>(this.StoreName, id) };
            return new Listing<StatBlock>(id, statBlock.Name, statBlock.Path, statBlock.Type, this.StoreName, "localStorage");
        });
        ko.utils.arrayPushAll(this.StatBlocks, listings);
    }

    public AddListings = (listings: ServerListing[], source: ListingOrigin) => {
        ko.utils.arrayPushAll<Listing<StatBlock>>(this.StatBlocks, listings.map(c => {
            return new Listing<StatBlock>(c.Id, c.Name, c.Path, c.SearchHint, c.Link, source);
        }));
    }

    public DeleteListing = (id: string) => {
        this.StatBlocks.remove(s => s.Id == id);
        Store.Delete(this.StoreName, id);
        this.accountClient.DeleteStatBlock(id);
    }

    private saveStatBlock = (listing: Listing<StatBlock>, newStatBlock: StatBlock) => {
        listing.Id = newStatBlock.Id;
        listing.Path = newStatBlock.Path;
        this.StatBlocks.push(listing);

        Store.Save<StatBlock>(this.StoreName, newStatBlock.Id, newStatBlock);
        listing.SetValue(newStatBlock);

        this.accountClient.SaveStatBlock(newStatBlock)
            .then(r => {
                if (!r || listing.Origin === "account") {
                    return;
                }
                const accountListing = new Listing<StatBlock>(newStatBlock.Id, newStatBlock.Name, newStatBlock.Path, newStatBlock.Type, `/my/statblocks/${newStatBlock.Id}`, "account", newStatBlock);
                this.StatBlocks.push(accountListing);
            });
    }
    
    public SaveEditedStatBlock = (listing: Listing<StatBlock>, newStatBlock: StatBlock) => {
        const oldStatBlocks = this.StatBlocks().filter(l => l.Id == listing.Id || l.Path + l.Name == listing.Path + listing.Name);
        for (const statBlock of oldStatBlocks) {
            this.DeleteListing(statBlock.Id);
        }
        this.saveStatBlock(listing, newStatBlock);
    }

    public SaveNewStatBlock = (newStatBlock: StatBlock) => {
        const listing = new Listing<StatBlock>(newStatBlock.Id, newStatBlock.Name, newStatBlock.Path, newStatBlock.Type, this.StoreName, "localStorage");
        this.saveStatBlock(listing, newStatBlock);
    }
}
