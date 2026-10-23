'use strict';

// Transcribed from the user's 23 October screenshots; reference answers are drafts.
module.exports = [
  {
    id: 910001, sourceNumber: 1, predictionId: 'pred26-user-swt-15',
    title: '2014 Olympics', category: 'Environment/Sport',
    text: `11 February 2009 – Major athletic events around the globe – from the 2014 Sochi Olympics to an annual powerboat race in Norwegian fjords – are striving to neutralize their carbon footprint as part of a world-wide climate network, the United Nations Environment Programme (UNEP) said today.

The sporting events are the latest participants to join the network, and are particularly important for inspiring further global action on the environment, said Achim Steiner, UNEP Executive Director.

"It is, therefore, heartening that this passion for excellence increasingly encompasses environmental performance, with sporting organizations raising the bar ever higher at each and every tournament," he added.

Organizers of the 2014 Sochi Olympic and Paralympic Winter Games – to be held in a unique natural setting between the shores of the Black Sea and the soaring snow-capped Caucasus Mountains – say they will put an estimated $1.75 billion into energy conservation and renewable energy.

That investment will be dedicated to improving transport infrastructure and offsetting greenhouse gas emissions from the use of electricity, air travel and ground transportation, the reforestation of Sochi National Park and the development of green belts in the city.`,
    keyElements: {
      what: 'Major sporting events, including the 2014 Sochi Olympics, are joining a climate network to neutralize their carbon footprint.',
      why: 'Sporting organizations can inspire wider global environmental action.',
      how: 'Sochi organizers plan to invest in energy conservation, renewable energy, transport improvements and emissions offsets.',
      result: 'The proposed investment includes reforestation and urban green belts to improve environmental performance.'
    },
    sampleResponse: 'Major sporting events, including the 2014 Sochi Olympics, are joining a climate network to neutralize their carbon footprint and inspire global environmental action; moreover, Sochi organizers plan to invest in energy conservation, renewable energy, transport improvements, emissions offsets and reforestation to improve environmental performance.'
  },
  {
    id: 910174, sourceNumber: 174, predictionId: 'pred26-user-swt-16',
    title: 'Image of Africa', category: 'Economics/Development',
    text: `Africa is not homogeneous. The negative impression of Africa held internationally is very unfair to those African countries that are actually doing well in their development, because this continent has more than 50 countries rich in natural resources which have not been completely exploited and cultural diversity, and hardworking Africans are struggling to address issues of poverty, disease and war, so Africa can be an attractive place for business development and cultural tourism if concerted international support and assistance are provided. This skewed perception overlooks the vibrant reality and immense potential of the continent.

Africa has a lot of potential, and years ago it brought benefits to some companies. Historical engagements have proven that forward-thinking businesses can find success. In fact, Africa is the region with the best investment returns. It is a paradise for investors and adventurers, but it still needs international aid. It is good to do business with Africans because of the mutual money and long-term growth prospects. Furthermore, beyond business, Africa is also beautiful, boasting landscapes and cultural heritage that make it a premier destination for cultural tourism, offering profound experiences for visitors.

However, to discuss Africa honestly, one must also acknowledge its struggles. Africa suffers from frequent wars and the causes are complex, rooted in historical legacies and competition over resources, not in any inherent trait of its people. Africans know what is needed in their development but need assistance in areas like technology transfer, infrastructure financing, and capacity building.`,
    keyElements: {
      what: 'Africa is diverse, and its negative international image overlooks developing countries and the continent’s potential.',
      why: 'Natural resources, cultural diversity and landscapes offer business, investment and tourism opportunities.',
      how: 'Africans are addressing poverty, disease and conflict while seeking support for development.',
      result: 'International assistance with technology, infrastructure and capacity building can help realize Africa’s potential.'
    },
    sampleResponse: 'Africa’s negative international image overlooks its diversity and development potential, as its natural resources, cultural heritage and landscapes offer opportunities for investment and tourism; however, poverty, disease and conflicts rooted in historical legacies and resource competition remain challenges, so international assistance with technology, infrastructure and capacity building can support African development.'
  },
  {
    id: 910030, sourceNumber: 30, predictionId: 'pred26-user-swt-17',
    title: 'Geothermal Energy', category: 'Energy/Environment',
    text: `What is the solution for nations with increasing energy demands, hindered by frequent power cuts and an inability to compete in the international oil market? For East Africa at least, experts think geothermal energy is the answer. More promising still, the Kenyan government and international investors seem to be listening. This is just in time according to many, as claims of an acute energy crisis are afoot due to high oil prices, population spikes and droughts. Currently over 60% of Kenya's power comes from hydroelectric sources but these are proving increasingly unreliable as the issue of seasonal variation is intensified by erratic rain patterns. Alternative energy sources are needed, and the leading energy supplier in Kenya, Kenya Electricity Generating Company, hopes to expand its geothermal energy supply from 13% to 25 % of its total usage by 2020. The potential of geothermal energy in the region was first realised internationally by the United Nations Development Program, when geologists observed thermal anomalies below the East African Rift system. Locals have been utilising this resource for centuries; using steam vents to create the perfect humidity for greenhouses, or simply to enjoy a swim in the many natural hot lakes. Along the 6000 km of the rift from the Red Sea to Mozambique, geochemical, geophysical and heat flow measurements were made to identify areas suitable for geothermal wells. One area lies next to the extinct Olkaria volcano, within the Hell's Gate National Park, and sits over some of the thinnest continental crust on Earth. This is a result of the thinning of the crust by tectonic stretching, causing hotter material below the Earth's surface to rise, resulting in higher temperatures. This thin crust was ideal for the drilling of geothermal wells, reaching depths of around 3000 m, where temperatures get up to 342°C, far higher than the usual temperature of 90°C at this depth. Water in the surrounding rocks is converted to steam by the heat. The steam can be used to drive turbines and produce electricity.`,
    keyElements: {
      what: 'Geothermal energy offers East Africa an alternative source of electricity.',
      why: 'High oil prices, population growth, droughts and unreliable hydroelectric supplies create an energy crisis.',
      how: 'Kenya plans to expand geothermal generation using the high temperatures beneath the East African Rift’s thin crust.',
      result: 'Underground heat converts water to steam that drives turbines to produce electricity.'
    },
    sampleResponse: 'Geothermal energy offers a solution to East Africa’s growing energy demands, as high oil prices, population growth and droughts make existing supplies unreliable; therefore, Kenya plans to expand geothermal generation by exploiting heat beneath the East African Rift’s thin crust, where water becomes steam that drives turbines to produce electricity.'
  }
].map(row => ({ ...row, sourceDate: '2026-10-23', sourceWeek: '23 October 2026' }));
