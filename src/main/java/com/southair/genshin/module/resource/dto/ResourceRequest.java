package com.southair.genshin.module.resource.dto;

import javax.validation.constraints.Max;
import javax.validation.constraints.Min;

/**
 * 资源更新请求：字段为空表示保持原值。
 */
public class ResourceRequest {

    @Min(value = 0, message = "原石不能为负数")
    @Max(value = 999999999L, message = "原石数值过大")
    private Long primogems;

    @Min(value = 0, message = "摩拉不能为负数")
    @Max(value = 999999999L, message = "摩拉数值过大")
    private Long mora;

    @Min(value = 0, message = "纠缠之缘不能为负数")
    @Max(value = 99999, message = "纠缠之缘数量过大")
    private Long intertwinedFates;

    @Min(value = 0, message = "相遇之缘不能为负数")
    @Max(value = 99999, message = "相遇之缘数量过大")
    private Long acquaintedFates;

    @Min(value = 0, message = "创世结晶不能为负数")
    @Max(value = 999999999L, message = "创世结晶数量过大")
    private Long genesisCrystals;

    @Min(value = 0, message = "每日原石不能为负数")
    @Max(value = 999999, message = "每日原石数值过大")
    private Long dailyPrimogems;

    @Min(value = 0, message = "大英雄的经验不能为负数")
    @Max(value = 999999, message = "大英雄的经验数量过大")
    private Long heroWit;

    @Min(value = 0, message = "冒险家的经验不能为负数")
    @Max(value = 999999, message = "冒险家的经验数量过大")
    private Long adventurerExp;

    @Min(value = 0, message = "流浪者的经验不能为负数")
    @Max(value = 999999, message = "流浪者的经验数量过大")
    private Long wandererAdvice;

    @Min(value = 0, message = "祝圣油膏不能为负数")
    @Max(value = 999999, message = "祝圣油膏数量过大")
    private Long sanctifyingUnction;

    @Min(value = 0, message = "祝圣精华不能为负数")
    @Max(value = 999999, message = "祝圣精华数量过大")
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

    public Long getDailyPrimogems() {
        return dailyPrimogems;
    }

    public void setDailyPrimogems(Long dailyPrimogems) {
        this.dailyPrimogems = dailyPrimogems;
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
