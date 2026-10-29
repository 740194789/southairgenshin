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

    List<WishRecord> findTop5ByUserIdAndGameOrderByWishTimeDesc(Long userId, String game);

    List<WishRecord> findByUserIdAndGameOrderByWishTimeAsc(Long userId, String game);

    List<WishRecord> findByUserIdAndGameAndPoolAndRarityOrderByWishTimeAscIdAsc(
            Long userId, String game, String pool, Integer rarity);

    long countByUserIdAndGame(Long userId, String game);

    long countByUserIdAndGameAndRarity(Long userId, String game, Integer rarity);

    @Query("select avg(w.pityCount) from WishRecord w"
            + " where w.userId = :userId and w.game = :game and w.rarity = 5")
    Double avgFiveStarPity(@Param("userId") Long userId, @Param("game") String game);

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
