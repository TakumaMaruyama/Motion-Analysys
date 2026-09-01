# Start analysis research sources

MotionAnalysys Start uses the following studies to define the product boundary,
metric definitions, and reference-band presentation. A cited relationship does
not by itself validate this application's computer-vision implementation.

## Primary design sources

1. Thng S, Pearson S, Mitchell LJG, Meulenbroek C, Keogh JWL. **On-block
   mechanistic determinants of start performance in high performance
   swimmers.** Sports Biomechanics. DOI
   [`10.1080/14763141.2021.1887342`](https://doi.org/10.1080/14763141.2021.1887342).
   Horizontal take-off velocity, work, average power, and acceleration all have
   strong relationships with 15 m performance. Phone video does not measure the
   force, work, or power variables.
2. van Dijk MP, Beek PJ, van Soest AJK. **Predicting dive start performance
   from kinematic variables at water entry in (sub-)elite swimmers.** PLOS ONE
   15(10):e0241345. DOI
   [`10.1371/journal.pone.0241345`](https://doi.org/10.1371/journal.pone.0241345).
   Entry distance, horizontal velocity, and angle are presented together rather
   than collapsed into a single score.
3. Tor E, Pease DL, Ball KA. **Key parameters of the swimming start and their
   relationship to start performance.** Journal of Sports Sciences 33(13),
   1313–1321. DOI
   [`10.1080/02640414.2014.990486`](https://doi.org/10.1080/02640414.2014.990486).
   Underwater trajectory is important but is outside the evidence available
   from one fixed above-water phone.
4. Born D-P, Nussbaumer L, Buck M, Ruiz-Navarro JJ, Romann M. **Engineering
   Elite Swimming Start Performance: Key Kinetic and Kinematic Variables with
   Reference Values.** Bioengineering 13(2), 180 (2026). DOI
   [`10.3390/bioengineering13020180`](https://doi.org/10.3390/bioengineering13020180).
   Appendix A is the source for versioned P3/P10/P25/P50/P75/P90/P97 values by
   stroke and sex category. The sample comprises Swiss national-team swimmers
   aged 13–32. The paper is licensed under CC BY 4.0.
5. Born et al. **Determining Validity and Reliability of an In-Field
   Performance Analysis System for Swimming.** Sensors 24(22), 7186 (2024).
   DOI [`10.3390/s24227186`](https://doi.org/10.3390/s24227186).
6. Matúš et al. **Validity and Reliability of 2D Video Analysis for Swimming
   Kick Start Kinematics.** Journal of Functional Morphology and Kinesiology
   10(2), 184 (2025). DOI
   [`10.3390/jfmk10020184`](https://doi.org/10.3390/jfmk10020184).

## Reference-data transformation

The Born et al. Appendix A percentile values are transcribed to versioned,
machine-readable records. MotionAnalysys changes the presentation from a paper
table to directional bands such as `P25–P50`. Time metrics explicitly use
lower-is-better direction and distance metrics explicitly use
higher-is-better direction. It does not create grades, pass/fail labels,
talent predictions, or a composite score.

The original paper and tables are © 2026 the authors and available under the
[Creative Commons Attribution 4.0 International
License](https://creativecommons.org/licenses/by/4.0/). Changes: transcription
to TypeScript, field-name normalization, metric-direction metadata, and band
presentation.
