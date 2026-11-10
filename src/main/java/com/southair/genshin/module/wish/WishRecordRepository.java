package com.southair.genshin.module.wish;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface WishRecordRepository extends JpaRepository<WishRecord, Long> {

    Page<WishRecord> findByUserIdAndGame(Long userId, String game, Pageable pageable);

    Optional<WishRecord> findFirstByUserIdAndGameAndClientUid(Long userId, String game, String clientUid);

    Page<WishRecord> findByUserIdAndGameAndPool(Long userId, String game, String pool, Pageable pageable);

    Page<WishRecord> findByUserIdAndGameAndRarity(
            Long userId, String game, Integer rarity, Pageable pageable);

    Page<WishRecord> findByUserIdAndGameAndPoolAndRarity(
            Long userId, String game, String pool, Integer rarity, Pageable pageable);

    /** 抽卡页筛选：卡池 / 星级 / UID / 名称关键词 / 时间范围，参数为空时不过滤。 */
    @Query("select w from WishRecord w where w.userId = :userId and w.game = :game"
            + " and (:pool is null or w.pool = :pool)"
            + " and (:rarity is null or w.rarity = :rarity)"
            + " and (:uid is null or w.uid = :uid)"
            + " and (:keyword is null or w.itemName like concat('%', :keyword, '%'))"
            + " and (:start is null or w.wishTime >= :start)"
            + " and (:end is null or w.wishTime <= :end)")
    Page<WishRecord> search(@Param("userId") Long userId,
                            @Param("game") String game,
                            @Param("pool") String pool,
                            @Param("rarity") Integer rarity,
                            @Param("uid") String uid,
                            @Param("keyword") String keyword,
                            @Param("start") LocalDateTime start,
                            @Param("end") LocalDateTime end,
                            Pageable pageable);

    /** 当前账号已出现过的 UID 列表，用于抽卡页筛选。 */
    @Query("select distinct w.uid from WishRecord w"
            + " where w.userId = :userId and w.game = :game and w.uid is not null and w.uid <> ''"
            + " order by w.uid")
    List<String> listUids(@Param("userId") Long userId, @Param("game") String game);

    List<WishRecord> findTop5ByUserIdAndGameOrderByWishTimeDesc(Long userId, String game);

    /** 最近出货只展示五星。 */
    List<WishRecord> findTop5ByUserIdAndGameAndRarityOrderByWishTimeDesc(
            Long userId, String game, Integer rarity);

    List<WishRecord> findByUserIdAndGameOrderByWishTimeAsc(Long userId, String game);

    List<WishRecord> findByUserIdAndGameAndPoolAndRarityOrderByWishTimeAscIdAsc(
            Long userId, String game, String pool, Integer rarity);

    long countByUserIdAndGame(Long userId, String game);

    long countByUserIdAndGameAndRarity(Long userId, String game, Integer rarity);

    @Query("select avg(w.pityCount) from WishRecord w"
            + " where w.userId = :userId and w.game = :game and w.rarity = 5")
    Double avgFiveStarPity(@Param("userId") Long userId, @Param("game") String game);

    /** 五星记录消耗的抽数之和，用于估算总抽数与五星出货率。 */
    @Query("select sum(w.pityCount) from WishRecord w"
            + " where w.userId = :userId and w.game = :game and w.rarity = 5")
    Long sumFiveStarPity(@Param("userId") Long userId, @Param("game") String game);

    @Query("select w.pool, count(w) from WishRecord w"
            + " where w.userId = :userId and w.game = :game group by w.pool order by count(w) desc")
    List<Object[]> countGroupByPool(@Param("userId") Long userId, @Param("game") String game);

    @Query("select count(w) from WishRecord w"
            + " where w.userId = :userId and w.game = :game and w.itemName = :itemName"
            + " and coalesce(w.pool, '') = coalesce(:pool, '') and w.wishTime = :wishTime")
    long countDuplicate(@Param("userId") Long userId,
                        @Param("game") String game,
                        @Param("itemName") String itemName,
                        @Param("pool") String pool,
                        @Param("wishTime") LocalDateTime wishTime);
}
