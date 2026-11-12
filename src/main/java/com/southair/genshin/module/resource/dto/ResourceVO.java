package com.southair.genshin.module.resource.dto;

import com.southair.genshin.module.resource.AccountResource;

import java.io.Serializable;

/**
 * 资源视图，包含抽数换算结果。
 *
 * <p>换算规则：1 抽 = 160 原石 / 星琼；常驻池抽数（相遇之缘 / 星轨通票）不计入货币折算。</p>
 */
public class ResourceVO implements Serializable {

    private static final long serialVersionUID = 1L;

    private Long id;

    private long primogems;
    private long mora;
    private long intertwinedFates;
    private long acquaintedFates;
    private long genesisCrystals;

    /** 每天自动累积的原石 / 星琼 */
    private long dailyPrimogems;

    /** 每日收入折算的抽数（向下取整） */
    private long dailyPulls;

    /** 每抽消耗原石 / 星琼 */
    private int primogemsPerPull;

    /** 原石 / 星琼可兑换的抽数（向下取整） */
    private long pullsFromPrimogems;

    /** 原石 / 星琼兑换后剩余的货币 */
    private long primogemsRemainder;

    /** 限定池抽数折算的货币（常驻池抽数不计入） */
    private long primogemsFromFates;

    /** 合计可抽数 = 货币可兑换 + 限定池抽数（常驻池抽数不计入） */
    private long totalPulls;

    /** 全部货币资产 = 货币 + 限定池抽数折算（常驻池抽数不计入） */
    private long totalPrimogems;

    /** 角色经验书 / 圣遗物经验素材的持有数量 */
    private long heroWit;
    private long adventurerExp;
    private long wandererAdvice;
    private long sanctifyingUnction;
    private long sanctifyingEssence;

    public static ResourceVO of(AccountResource entity, int primogemsPerPull) {
        ResourceVO vo = new ResourceVO();
        int unit = primogemsPerPull <= 0 ? 160 : primogemsPerPull;
        vo.id = entity.getId();
        vo.primogems = nvl(entity.getPrimogems());
        vo.mora = nvl(entity.getMora());
        vo.intertwinedFates = nvl(entity.getIntertwinedFates());
        vo.acquaintedFates = nvl(entity.getAcquaintedFates());
        vo.genesisCrystals = nvl(entity.getGenesisCrystals());
        vo.dailyPrimogems = nvl(entity.getDailyPrimogems());
        vo.heroWit = nvl(entity.getHeroWit());
        vo.adventurerExp = nvl(entity.getAdventurerExp());
        vo.wandererAdvice = nvl(entity.getWandererAdvice());
        vo.sanctifyingUnction = nvl(entity.getSanctifyingUnction());
        vo.sanctifyingEssence = nvl(entity.getSanctifyingEssence());
        vo.primogemsPerPull = unit;
        vo.pullsFromPrimogems = vo.primogems / unit;
        vo.primogemsRemainder = vo.primogems % unit;
        vo.primogemsFromFates = vo.intertwinedFates * unit;
        vo.totalPulls = vo.pullsFromPrimogems + vo.intertwinedFates;
        vo.totalPrimogems = vo.primogems + vo.primogemsFromFates;
        vo.dailyPulls = vo.dailyPrimogems / unit;
        return vo;
    }

    private static long nvl(Long value) {
        return value == null ? 0L : value;
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public long getPrimogems() {
        return primogems;
    }

    public void setPrimogems(long primogems) {
        this.primogems = primogems;
    }

    public long getMora() {
        return mora;
    }

    public void setMora(long mora) {
        this.mora = mora;
    }

    public long getIntertwinedFates() {
        return intertwinedFates;
    }

    public void setIntertwinedFates(long intertwinedFates) {
        this.intertwinedFates = intertwinedFates;
    }

    public long getAcquaintedFates() {
        return acquaintedFates;
    }

    public void setAcquaintedFates(long acquaintedFates) {
        this.acquaintedFates = acquaintedFates;
    }

    public long getGenesisCrystals() {
        return genesisCrystals;
    }

    public void setGenesisCrystals(long genesisCrystals) {
        this.genesisCrystals = genesisCrystals;
    }

    public int getPrimogemsPerPull() {
        return primogemsPerPull;
    }

    public void setPrimogemsPerPull(int primogemsPerPull) {
        this.primogemsPerPull = primogemsPerPull;
    }

    public long getPullsFromPrimogems() {
        return pullsFromPrimogems;
    }

    public void setPullsFromPrimogems(long pullsFromPrimogems) {
        this.pullsFromPrimogems = pullsFromPrimogems;
    }

    public long getPrimogemsRemainder() {
        return primogemsRemainder;
    }

    public void setPrimogemsRemainder(long primogemsRemainder) {
        this.primogemsRemainder = primogemsRemainder;
    }

    public long getPrimogemsFromFates() {
        return primogemsFromFates;
    }

    public void setPrimogemsFromFates(long primogemsFromFates) {
        this.primogemsFromFates = primogemsFromFates;
    }

    public long getTotalPulls() {
        return totalPulls;
    }

    public void setTotalPulls(long totalPulls) {
        this.totalPulls = totalPulls;
    }

    public long getTotalPrimogems() {
        return totalPrimogems;
    }

    public void setTotalPrimogems(long totalPrimogems) {
        this.totalPrimogems = totalPrimogems;
    }

    public long getDailyPrimogems() {
        return dailyPrimogems;
    }

    public void setDailyPrimogems(long dailyPrimogems) {
        this.dailyPrimogems = dailyPrimogems;
    }

    public long getDailyPulls() {
        return dailyPulls;
    }

    public void setDailyPulls(long dailyPulls) {
        this.dailyPulls = dailyPulls;
    }

    public long getHeroWit() {
        return heroWit;
    }

    public void setHeroWit(long heroWit) {
        this.heroWit = heroWit;
    }

    public long getAdventurerExp() {
        return adventurerExp;
    }

    public void setAdventurerExp(long adventurerExp) {
        this.adventurerExp = adventurerExp;
    }

    public long getWandererAdvice() {
        return wandererAdvice;
    }

    public void setWandererAdvice(long wandererAdvice) {
        this.wandererAdvice = wandererAdvice;
    }

    public long getSanctifyingUnction() {
        return sanctifyingUnction;
    }

    public void setSanctifyingUnction(long sanctifyingUnction) {
        this.sanctifyingUnction = sanctifyingUnction;
    }

    public long getSanctifyingEssence() {
        return sanctifyingEssence;
    }

    public void setSanctifyingEssence(long sanctifyingEssence) {
        this.sanctifyingEssence = sanctifyingEssence;
    }
}
