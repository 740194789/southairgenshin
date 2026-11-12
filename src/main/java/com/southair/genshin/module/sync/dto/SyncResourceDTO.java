package com.southair.genshin.module.sync.dto;

import java.io.Serializable;

/**
 * 同步用的资源快照：四个数值 + 客户端编辑时间。
 */
public class SyncResourceDTO implements Serializable {

    private static final long serialVersionUID = 1L;

    private Long primogems;
    private Long mora;
    private Long intertwinedFates;
    private Long acquaintedFates;
    private Long genesisCrystals;
    private Long editedAt;

    private Long heroWit;
    private Long adventurerExp;
    private Long wandererAdvice;
    private Long sanctifyingUnction;
    private Long sanctifyingEssence;

    public Long getPrimogems() {
        return primogems;
    }

    public void setPrimogems(Long primogems) {
        this.primogems = primogems;
    }

    public Long getMora() {
        return mora;
    }

    public void setMora(Long mora) {
        this.mora = mora;
    }

    public Long getIntertwinedFates() {
        return intertwinedFates;
    }

    public void setIntertwinedFates(Long intertwinedFates) {
        this.intertwinedFates = intertwinedFates;
    }

    public Long getAcquaintedFates() {
        return acquaintedFates;
    }

    public void setAcquaintedFates(Long acquaintedFates) {
        this.acquaintedFates = acquaintedFates;
    }

    public Long getGenesisCrystals() {
        return genesisCrystals;
    }

    public void setGenesisCrystals(Long genesisCrystals) {
        this.genesisCrystals = genesisCrystals;
    }

    public Long getEditedAt() {
        return editedAt;
    }

    public void setEditedAt(Long editedAt) {
        this.editedAt = editedAt;
    }

    public Long getHeroWit() {
        return heroWit;
    }

    public void setHeroWit(Long heroWit) {
        this.heroWit = heroWit;
    }

    public Long getAdventurerExp() {
        return adventurerExp;
    }

    public void setAdventurerExp(Long adventurerExp) {
        this.adventurerExp = adventurerExp;
    }

    public Long getWandererAdvice() {
        return wandererAdvice;
    }

    public void setWandererAdvice(Long wandererAdvice) {
        this.wandererAdvice = wandererAdvice;
    }

    public Long getSanctifyingUnction() {
        return sanctifyingUnction;
    }

    public void setSanctifyingUnction(Long sanctifyingUnction) {
        this.sanctifyingUnction = sanctifyingUnction;
    }

    public Long getSanctifyingEssence() {
        return sanctifyingEssence;
    }

    public void setSanctifyingEssence(Long sanctifyingEssence) {
        this.sanctifyingEssence = sanctifyingEssence;
    }
}

